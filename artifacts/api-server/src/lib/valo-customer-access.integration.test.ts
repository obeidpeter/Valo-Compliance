import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  valoAccessSupport,
  valoStaffAssignments,
  valoStaffAccessAudit,
  valoMemberships,
  valoDocuments,
  valoDocumentRevisions,
  valoSupportTickets,
  valoEvents,
  valoWorkspaces,
  valoPrivacyCases,
  valoPrivacyEvents,
  valoPrivacyTombstones,
  valoExportJobs,
  valoFileAssets,
} from "@workspace/db";
import { customerPrivacyDetail } from "./valo-privacy";
import {
  saveAccessSupport,
  customerAccount,
  requestPrivacy,
  workspaceDataExport,
  staffOperations,
} from "./valo-customer-access";
import { resolveWorkspace, createDocument, ValoProblem } from "./valo-store";
import { syntheticDocument } from "./valo-test-fixtures";
import { withWorkspaceDataFile } from "./valo-data-download";
import { readFile, stat } from "node:fs/promises";
test(
  "real development access intake, privacy isolation and staff boundaries",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const run = randomUUID(),
      email = `access-${run}@example.invalid`,
      socket = `synthetic-${run}`;
    const input = {
      idempotencyKey: randomUUID(),
      email,
      topic: "account_access" as const,
      message: "Synthetic account access problem. No confidential details.",
    };
    const a = await resolveWorkspace(`synthetic-access-a-${run}`),
      b = await resolveWorkspace(`synthetic-access-b-${run}`);
    const staff = `synthetic-staff-${run}`,
      role = randomUUID();
    const ids = [a.workspaceId, b.workspaceId];
    try {
      await t.test(
        "no login or account lookup is needed; confirmation is saved, never dispatched",
        async () => {
          const r = await saveAccessSupport(input, socket);
          assert.equal(r.delivery, "not_dispatched");
          assert.match(r.message, /No account details/);
          const [stored] = await db
            .select()
            .from(valoAccessSupport)
            .where(eq(valoAccessSupport.idempotencyKey, input.idempotencyKey));
          assert.equal(stored.status, "awaiting_staff");
          assert.equal(stored.contactEmail, email);
        },
      );
      await t.test("idempotent retry preserves one record; altered reuse fails", async () => {
        assert.deepEqual(await saveAccessSupport(input, socket), await saveAccessSupport(input, socket));
        assert.equal(
          (
            await db
              .select()
              .from(valoAccessSupport)
              .where(eq(valoAccessSupport.idempotencyKey, input.idempotencyKey))
          ).length,
          1,
        );
        await assert.rejects(
          () =>
            saveAccessSupport(
              { ...input, message: "A different synthetic request using the same identifier." },
              socket,
            ),
          (e: unknown) => e instanceof ValoProblem && e.status === 409,
        );
      });
      await t.test("honeypot and invalid email fail without saving", async () => {
        await assert.rejects(() =>
          saveAccessSupport({ ...input, idempotencyKey: randomUUID(), website: "bot" }, socket),
        );
        await assert.rejects(() =>
          saveAccessSupport({ ...input, idempotencyKey: randomUUID(), email: "not-an-email" }, socket),
        );
      });
      await t.test(
        "concurrent verified-or-unverified contacts cannot create unlimited anonymous tickets",
        async () => {
          const same = `burst-${run}@example.invalid`;
          const results = await Promise.allSettled(
            Array.from({ length: 15 }, () =>
              saveAccessSupport({ ...input, email: same, idempotencyKey: randomUUID() }, socket),
            ),
          );
          assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
          for (const r of results)
            if (r.status === "rejected") {
              assert.ok(r.reason instanceof ValoProblem);
              assert.equal(r.reason.status, 429);
              assert.ok((r.reason.retryAfter ?? 0) > 0);
            }
          assert.equal(
            (await db.select().from(valoAccessSupport).where(eq(valoAccessSupport.contactEmail, same)))
              .length,
            3,
          );
        },
      );
      await t.test("different contacts receive the same non-enumerating wording", async () => {
        const other = await saveAccessSupport(
          { ...input, email: `other-${run}@example.invalid`, idempotencyKey: randomUUID() },
          socket,
        );
        const original = await saveAccessSupport(input, socket);
        assert.equal(other.message, original.message);
        assert.equal(other.delivery, original.delivery);
        assert.equal(other.reference.length, original.reference.length);
      });
      await t.test("privacy requests really persist and do not claim deletion", async () => {
        const r = await requestPrivacy(a, email, {
          kind: "deletion",
          message: "Synthetic request to remove this test workspace later.",
          acknowledgement: true,
        });
        assert.match(r.message, /no export, correction, deletion or provider action has been completed/i);
        assert.equal((await customerAccount(a)).privacyRequests.length, 1);
        assert.equal((await customerAccount(b)).privacyRequests.length, 0);
        const request = await customerPrivacyDetail(a, r.reference.slice(5));
        assert.equal(request.request.status, "awaiting_verification");
        assert.equal(request.request.resultAvailable, false);
        assert.equal(request.events.length, 1);
        await assert.rejects(() => customerPrivacyDetail(b, r.reference.slice(5)), { status: 404 });
      });
      await t.test(
        "workspace JSON export includes saved revisions but excludes another business",
        async () => {
          const doc = await createDocument(a, syntheticDocument);
          const own = await workspaceDataExport(a),
            other = await workspaceDataExport(b);
          assert.equal(own.workspaceId, a.workspaceId);
          assert.ok((own.data.documents as { id: string }[]).some((r) => r.id === doc.id));
          assert.equal((other.data.documents as unknown[]).length, 0);
          assert.ok(!JSON.stringify(other).includes(doc.id));
        },
      );
      await t.test(
        "JSON v2 includes owned file/job metadata, never private locators or queue identifiers",
        async () => {
          const [doc] = await db
            .select()
            .from(valoDocuments)
            .where(eq(valoDocuments.workspaceId, a.workspaceId));
          const [revision] = await db
            .select()
            .from(valoDocumentRevisions)
            .where(eq(valoDocumentRevisions.documentId, doc.id));
          const jobId = randomUUID(),
            assetId = randomUUID(),
            queueId = randomUUID();
          const locator = `synthetic-private-locator-${run}`;
          // Metadata-only failed fixture: no object, render, queue delivery or provider call.
          await db.insert(valoExportJobs).values({
            id: jobId,
            workspaceId: a.workspaceId,
            documentId: doc.id,
            revisionId: revision.id,
            revision: revision.revision,
            format: "docx",
            renderVersion: "synthetic-metadata-only",
            sourceHash: revision.contentHash,
            requestedBy: a.identityId,
            queueId,
            status: "failed",
            errorCode: "SYNTHETIC_METADATA_ONLY",
          });
          await db.insert(valoFileAssets).values({
            id: assetId,
            workspaceId: a.workspaceId,
            jobId,
            objectKey: locator,
            checksum: "c".repeat(64),
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 17,
          });
          const own = await workspaceDataExport(a),
            other = await workspaceDataExport(b);
          assert.equal(own.schemaVersion, 2);
          assert.ok((own.data.exportJobs as { id: string }[]).some((r) => r.id === jobId));
          assert.ok(
            (own.data.fileMetadata as { id: string; size: number }[]).some(
              (r) => r.id === assetId && r.size === 17,
            ),
          );
          for (const forbidden of [locator, queueId])
            assert.equal(JSON.stringify(own).includes(forbidden), false);
          for (const forbidden of [jobId, assetId, locator])
            assert.equal(JSON.stringify(other).includes(forbidden), false);
          assert.match(own.scope, /not complete privacy fulfilment/);
          assert.match(own.scope, /not private file bytes\/storage locators/);
          assert.match(own.scope, /Previously prepared full workspace snapshots are deliberately not nested/);
        },
      );
      await t.test("activity export is restricted to this requester and workspace", async () => {
        const otherActor = `synthetic-other-actor-${run}`,
          eventId = randomUUID();
        await db.insert(valoEvents).values({
          id: eventId,
          workspaceId: a.workspaceId,
          actorId: otherActor,
          action: "synthetic.other_actor_event",
          entityId: a.workspaceId,
        });
        const own = await workspaceDataExport(a);
        const activity = own.data.yourActivity as { actorId: string; workspaceId: string }[];
        assert.ok(activity.length > 0);
        assert.ok(activity.every((r) => r.actorId === a.identityId && r.workspaceId === a.workspaceId));
        assert.equal(JSON.stringify(own).includes(otherActor), false);
        assert.equal(JSON.stringify(own).includes(eventId), false);
      });
      await t.test(
        "an over-limit metadata section fails explicitly rather than returning a truncated download",
        async () => {
          await db.insert(valoEvents).values(
            Array.from({ length: 5001 }, () => ({
              id: randomUUID(),
              workspaceId: a.workspaceId,
              actorId: a.identityId,
              action: "synthetic.export_limit_case",
              entityId: a.workspaceId,
            })),
          );
          await assert.rejects(
            () => workspaceDataExport(a),
            (error: unknown) =>
              error instanceof ValoProblem &&
              error.status === 409 &&
              /no partial file was returned/.test(error.message),
          );
        },
      );
      await t.test(
        "large scoped download spans pages without truncation, private fields or another tenant; scratch is removed",
        async () => {
          let scratch = "";
          const count = await withWorkspaceDataFile(a, async (path) => {
            scratch = path;
            assert.equal((await stat(path)).mode & 0o777, 0o600);
            const body = JSON.parse(await readFile(path, "utf8"));
            assert.equal(body.schemaVersion, 2);
            assert.ok(body.data.yourActivity.length >= 5001);
            for (const rows of Object.values(body.data) as Record<string, unknown>[][])
              for (const row of rows) assert.equal(row.workspaceId, a.workspaceId);
            assert.ok(
              body.data.yourActivity.every((row: { actorId: string }) => row.actorId === a.identityId),
            );
            assert.ok(
              body.data.fileMetadata.every((row: Record<string, unknown>) => !("storageLocator" in row)),
            );
            return body.data.yourActivity.length;
          });
          assert.ok(count >= 5001);
          await assert.rejects(stat(scratch), { code: "ENOENT" });
        },
      );
      await t.test(
        "download consumer failure removes private scratch instead of leaving a prepared result",
        async () => {
          let scratch = "";
          await assert.rejects(
            () =>
              withWorkspaceDataFile(b, async (path) => {
                scratch = path;
                throw new Error("synthetic disconnected reader");
              }),
            /synthetic disconnected/,
          );
          await assert.rejects(stat(scratch), { code: "ENOENT" });
        },
      );
      await t.test("revoked membership cannot retrieve exports or saved privacy requests", async () => {
        await db
          .update(valoMemberships)
          .set({ active: "no" })
          .where(eq(valoMemberships.workspaceId, b.workspaceId));
        for (const action of [() => workspaceDataExport(b), () => customerAccount(b)])
          await assert.rejects(action, (e: unknown) => e instanceof ValoProblem && e.status === 403);
      });
      await t.test("no staff permission, missing MFA and cross-area substitution all fail", async () => {
        const staffActor = (recentMfa = true) => ({ identityId: staff, recentMfa, verifiedAt: Date.now() });
        await assert.rejects(() => staffOperations(staffActor(), "finance"), /no active permission/);
        await db.insert(valoStaffAssignments).values({
          id: role,
          identityId: staff,
          role: "finance",
          grantedBy: "synthetic-fixture",
          reason: "Isolated service-level negative test; not an actual staff approval",
        });
        await assert.rejects(() => staffOperations(staffActor(false), "finance"), /multi-factor/);
        await assert.rejects(() => staffOperations(staffActor(), "support"), /no active permission/);
        const r = await staffOperations(staffActor(), "finance");
        assert.ok(
          r.records.every(
            (record) =>
              !Object.hasOwn(record, "body") &&
              !Object.hasOwn(record, "content") &&
              !Object.hasOwn(record, "line"),
          ),
        );
        assert.match(r.notice, /Test-mode financial records/);
        assert.equal(
          (await db.select().from(valoStaffAccessAudit).where(eq(valoStaffAccessAudit.assignmentId, role)))
            .length,
          1,
        );
        await db.update(valoStaffAssignments).set({ active: false }).where(eq(valoStaffAssignments.id, role));
        await assert.rejects(() => staffOperations(staffActor(), "finance"), /no active permission/);
      });
    } finally {
      await db.delete(valoStaffAccessAudit).where(eq(valoStaffAccessAudit.assignmentId, role));
      await db.delete(valoStaffAssignments).where(eq(valoStaffAssignments.id, role));
      for (const contact of [email, `burst-${run}@example.invalid`, `other-${run}@example.invalid`])
        await db.delete(valoAccessSupport).where(eq(valoAccessSupport.contactEmail, contact));
      await db.delete(valoFileAssets).where(inArray(valoFileAssets.workspaceId, ids));
      await db.delete(valoExportJobs).where(inArray(valoExportJobs.workspaceId, ids));
      await db.delete(valoDocumentRevisions).where(inArray(valoDocumentRevisions.workspaceId, ids));
      await db.delete(valoDocuments).where(inArray(valoDocuments.workspaceId, ids));
      await db.delete(valoPrivacyEvents).where(inArray(valoPrivacyEvents.workspaceId, ids));
      await db.delete(valoPrivacyTombstones).where(inArray(valoPrivacyTombstones.workspaceId, ids));
      await db.delete(valoPrivacyCases).where(inArray(valoPrivacyCases.workspaceId, ids));
      await db.delete(valoSupportTickets).where(inArray(valoSupportTickets.workspaceId, ids));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, ids));
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, ids));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, ids));
      await pool.end();
    }
  },
);
