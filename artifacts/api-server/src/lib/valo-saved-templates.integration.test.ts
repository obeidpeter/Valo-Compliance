import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  valoSavedTemplates,
  valoWorkspaces,
  valoMemberships,
  valoEvents,
  valoContentVersions,
} from "@workspace/db";
import { disclosure, publicationSchema } from "@workspace/valo-core";
import { resolveWorkspace } from "./valo-store";
import { syntheticDocument } from "./valo-test-fixtures";
import { financeHeldFixture } from "./valo-finance-test-fixture";

test(
  "actual PostgreSQL saved-template ownership, durable state and blocked-release boundaries",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 40000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    const a = await resolveWorkspace("synthetic-saved-" + randomUUID()),
      b = await resolveWorkspace("synthetic-saved-other-" + randomUUID());
    const held = await financeHeldFixture(),
      actual = await import("./valo-released-content");
    await assert.rejects(
      db.transaction((tx) => actual.lockedLiveVersion(tx, held.id)),
      { status: 404 },
    );
    // Only the eligibility adapter is controlled for positive storage mechanics.
    // The native row stays held, with zero review/rights/publication assertions.
    const hash = "a".repeat(64),
      bundle = publicationSchema.parse({
        candidate: {
          id: "TPL-01",
          version: 1,
          body: JSON.stringify(syntheticDocument),
          hash,
          contentClass: "general_template",
          jurisdiction: "NG",
          risk: "general",
          scope: "Synthetic saved metadata test",
          limitations: "Never published",
          assumptions: [],
          unresolvedMaterialIssues: ["Not released"],
          missingEvidence: ["All release evidence"],
          sourceCheckDate: "2026-01-01T00:00:00Z",
          disclosure,
          claims: [],
        },
        sources: [],
        rights: { status: "unknown", evidence: "None", evidenceHash: hash, commercialUse: false },
        policy: {
          version: "controlled",
          hash,
          ownerApproved: false,
          allowedClasses: [],
          jurisdictions: [],
          risks: [],
          officialHosts: ["example.invalid"],
          blockedActivities: [],
        },
        draftRun: {
          runId: "not-a-provider-run",
          model: "controlled",
          promptVersion: "controlled",
          candidateHash: hash,
          evidenceHash: hash,
        },
        reviews: [],
        enhancedChecks: [],
        mechanicalChecks: [],
        exports: [],
        manifest: {
          candidateHash: hash,
          evidenceHash: hash,
          rightsHash: hash,
          policyHash: hash,
          reviewHash: hash,
          checksHash: hash,
          exportsHash: hash,
          status: "review",
        },
      });
    const fixture = { ...held, templateId: "TPL-01", bundle };
    let available = true;
    t.mock.module("./valo-released-content.ts", {
      namedExports: {
        ...actual,
        liveReleasedVersions: async () => (available ? [fixture] : []),
        lockedLiveVersion: async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string) => {
          await tx.select().from(valoContentVersions).where(eq(valoContentVersions.id, id)).for("share");
          if (!available || id !== held.id) return actual.lockedLiveVersion(tx, id);
          return fixture;
        },
      },
    });
    const service = await import("./valo-saved-templates"),
      { workspaceDataExport } = await import("./valo-customer-access");
    try {
      await t.test("concurrent tabs persist one save and one event; new reads see it", async () => {
        await Promise.all(Array.from({ length: 6 }, () => service.saveTemplate(a, held.id)));
        assert.equal((await service.savedTemplateList(a)).items.length, 1);
        assert.equal(
          (
            await db
              .select()
              .from(valoEvents)
              .where(and(eq(valoEvents.workspaceId, a.workspaceId), eq(valoEvents.action, "template.saved")))
          ).length,
          1,
        );
        assert.equal(
          (
            await db
              .select()
              .from(valoSavedTemplates)
              .where(eq(valoSavedTemplates.workspaceId, a.workspaceId))
          ).length,
          1,
        );
        assert.equal((await service.savedTemplateList(b)).items.length, 0);
        const exported = await workspaceDataExport(a);
        assert.equal((exported.data.savedTemplates as unknown[]).length, 1);
      });
      await t.test("forged tenant, nonowner and revoked identities cannot read or remove", async () => {
        await assert.rejects(service.savedTemplateList({ ...a, identityId: b.identityId }), { status: 403 });
        await assert.rejects(service.unsaveTemplate({ ...a, identityId: b.identityId }, "TPL-01"), {
          status: 403,
        });
        await db
          .update(valoMemberships)
          .set({ active: "no" })
          .where(eq(valoMemberships.identityId, a.identityId));
        await assert.rejects(service.savedTemplateList(a), { status: 403 });
        await assert.rejects(service.unsaveTemplate(a, "TPL-01"), { status: 403 });
        await db
          .update(valoMemberships)
          .set({ active: "yes" })
          .where(eq(valoMemberships.identityId, a.identityId));
        await db
          .update(valoMemberships)
          .set({ role: "member" })
          .where(eq(valoMemberships.identityId, a.identityId));
        await assert.rejects(service.saveTemplate(a, held.id), { status: 403 });
        await db
          .update(valoMemberships)
          .set({ role: "owner" })
          .where(eq(valoMemberships.identityId, a.identityId));
      });
      await t.test("withdrawal preserves only title snapshot; removal remains idempotent", async () => {
        available = false;
        const item = (await service.savedTemplateList(a)).items[0]!;
        assert.equal(item.available, false);
        assert.equal(item.current, null);
        assert.equal(item.title, syntheticDocument.title);
        await assert.rejects(service.saveTemplate(b, held.id), { status: 404 });
        await Promise.all([service.unsaveTemplate(a, "TPL-01"), service.unsaveTemplate(a, "TPL-01")]);
        assert.equal((await service.savedTemplateList(a)).items.length, 0);
        assert.equal(
          (
            await db
              .select()
              .from(valoEvents)
              .where(
                and(eq(valoEvents.workspaceId, a.workspaceId), eq(valoEvents.action, "template.unsaved")),
              )
          ).length,
          1,
        );
      });
      await t.test("membership revocation committed while save waits wins", async () => {
        available = true;
        let unlocked!: () => void, ready!: () => void;
        const blocked = new Promise<void>((r) => (unlocked = r)),
          locked = new Promise<void>((r) => (ready = r));
        const lock = db.transaction(async (tx) => {
          await tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.id, a.workspaceId)).for("update");
          ready();
          await blocked;
        });
        await locked;
        const attempt = service.saveTemplate(a, held.id);
        const observed = assert.rejects(attempt, { status: 403 });
        await db
          .update(valoMemberships)
          .set({ active: "no" })
          .where(eq(valoMemberships.identityId, a.identityId));
        unlocked();
        await lock;
        await observed;
        assert.equal(
          (
            await db
              .select()
              .from(valoSavedTemplates)
              .where(eq(valoSavedTemplates.workspaceId, a.workspaceId))
          ).length,
          0,
        );
      });
    } finally {
      for (const table of [valoSavedTemplates, valoEvents, valoMemberships])
        await db.delete(table).where(inArray(table.workspaceId, [a.workspaceId, b.workspaceId]));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, [a.workspaceId, b.workspaceId]));
      t.mock.restoreAll();
      await pool.end();
    }
  },
);
