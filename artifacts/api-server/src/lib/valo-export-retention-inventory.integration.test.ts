import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  valoExportJobs as jobs,
  valoFileAssets as assets,
  valoExportObjects as objects,
  valoExportRequests,
  valoDocuments,
  valoDocumentRevisions,
  valoEvents,
  valoMemberships,
  valoWorkspaces,
  valoPrivacyCases,
  valoPrivacyEvents,
  valoSupportTickets,
} from "@workspace/db";
import { createDocument } from "../modules/documents";
import { resolveWorkspace } from "../modules/workspaces";
import { syntheticDocument } from "./valo-test-fixtures";
import { createPrivacyCase } from "../modules/privacy/valo-privacy";
import { inspectExportRetention, proposeExportRetention } from "./valo-export-retention-inventory";

test(
  "retention inspection is a read-only, identity-bound snapshot and never authorizes legacy deletion",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 60_000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    assert.ok(
      !Object.entries(process.env).some(([key, value]) => key.startsWith("REPLIT_DEPLOYMENT") && value),
    );
    const connection = await pool.connect();
    const target = {
      databaseId: (
        await connection.query("SELECT instance_id FROM valo_runtime_identity WHERE singleton=true")
      ).rows[0].instance_id as string,
      environment: "development" as const,
    };
    const actors: Awaited<ReturnType<typeof resolveWorkspace>>[] = [],
      cases: string[] = [];
    const seed = async (retentionAt: Date | null = null) => {
      const actor = await resolveWorkspace("synthetic-retention-inventory-" + randomUUID());
      actors.push(actor);
      const doc = await createDocument(actor, structuredClone(syntheticDocument)),
        id = randomUUID(),
        assetId = randomUUID(),
        queueId = randomUUID();
      const key = `valo/development/${actor.workspaceId}/${assetId}.docx`;
      await db.insert(jobs).values({
        id,
        workspaceId: actor.workspaceId,
        documentId: doc.id,
        revisionId: doc.revisionId,
        revision: 1,
        format: "docx",
        renderVersion: "inventory-fixture",
        sourceHash: "a".repeat(64),
        requestedBy: actor.identityId,
        queueId,
        status: "ready",
      });
      await db
        .insert(objects)
        .values({ objectKey: key, workspaceId: actor.workspaceId, jobId: id, queueId, state: "retained" });
      await db.insert(assets).values({
        id: assetId,
        workspaceId: actor.workspaceId,
        jobId: id,
        objectKey: key,
        checksum: "b".repeat(64),
        size: 32,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        retentionAt,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      return { actor, id, assetId, key };
    };
    const snapshot = async () => {
      const rows = await connection.query(
        `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
      );
      const snapshots = [];
      for (const { tablename } of rows.rows) {
        assert.match(tablename, /^[a-z_]+$/);
        const result = await connection.query(
          `SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "${tablename}" t`,
        );
        snapshots.push([tablename, result.rows[0].digest]);
      }
      return snapshots;
    };
    try {
      const legacy = await seed(),
        assigned = await seed(new Date("2098-01-01T00:00:00Z")),
        broken = await seed(),
        privateAsset = await seed();
      await db.delete(objects).where(eq(objects.objectKey, broken.key));
      const request = await createPrivacyCase(privateAsset.actor, "synthetic@example.invalid", {
        kind: "deletion",
        idempotencyKey: randomUUID(),
        message: "Synthetic inventory privacy fixture; never authorize deletion from raw status.",
        acknowledgement: true,
      });
      cases.push(request.reference.slice(5));
      const options = { effectiveAt: "2090-01-01T00:00:00.000Z", retentionDays: 30, graceDays: 7 };
      await t.test(
        "database rows stay byte-identical; unchanged snapshots and proposals have stable fingerprints",
        async () => {
          const before = await snapshot(),
            one = await inspectExportRetention(connection, target),
            two = await inspectExportRetention(connection, target);
          assert.deepEqual(await snapshot(), before);
          assert.equal(one.fingerprint, two.fingerprint);
          assert.equal(one.readOnly, true);
          assert.equal(one.launchReady, false);
          const plan = proposeExportRetention(one, options);
          assert.equal(plan.proposalFingerprint, proposeExportRetention(two, options).proposalFingerprint);
          assert.equal(plan.applied, false);
          assert.equal(plan.approvalRequired, true);
          assert.deepEqual(
            plan.changes.filter((c) => c.assetId === legacy.assetId).map((c) => c.proposedRetentionAt),
            ["2090-01-08T00:00:00.000Z"],
          );
          for (const item of [assigned, broken, privateAsset])
            assert.equal(
              plan.changes.some((c) => c.assetId === item.assetId),
              false,
            );
          assert.ok(
            one.entries
              .find((e) => e.assetId === broken.assetId)!
              .blockers.includes("RESERVATION_BINDING_INVALID"),
          );
          assert.ok(
            one.entries
              .find((e) => e.assetId === privateAsset.assetId)!
              .blockers.includes("PRIVACY_HISTORY_REQUIRES_REVIEW"),
          );
          assert.equal(one.retentionCoverageComplete, false);
          const text = JSON.stringify({ one, plan });
          assert.ok(!text.includes(legacy.key));
          assert.ok(!text.includes("synthetic@example.invalid"));
          assert.ok(!text.includes("never authorize deletion"));
          assert.ok(!text.includes("b".repeat(64)));
        },
      );
      await t.test(
        "identity mismatch fails and rolls back; subsequent connection remains usable",
        async () => {
          await assert.rejects(
            inspectExportRetention(connection, { ...target, databaseId: randomUUID() }),
            /RETENTION_DATABASE_IDENTITY_MISMATCH/,
          );
          assert.equal(
            (await connection.query("SHOW transaction_read_only")).rows[0].transaction_read_only,
            "off",
          );
          assert.equal((await inspectExportRetention(connection, target)).databaseId, target.databaseId);
        },
      );
      await t.test(
        "newer legacy files keep their full retention window; invalid generation and dates are excluded",
        async () => {
          const createdAt = new Date(Date.now() - 60_000);
          await db.update(assets).set({ createdAt }).where(eq(assets.id, legacy.assetId));
          const inventory = await inspectExportRetention(connection, target);
          const effectiveAt = new Date(Date.parse(inventory.observedAt) + 60_000).toISOString();
          const change = proposeExportRetention(inventory, { ...options, effectiveAt }).changes.find(
            (c) => c.assetId === legacy.assetId,
          )!;
          assert.equal(
            change.proposedRetentionAt,
            new Date(createdAt.getTime() + 30 * 86_400_000).toISOString(),
          );
          await db
            .update(assets)
            .set({ createdAt: new Date("2099-01-01T00:00:00Z") })
            .where(eq(assets.id, legacy.assetId));
          assert.ok(
            (await inspectExportRetention(connection, target)).entries
              .find((e) => e.assetId === legacy.assetId)!
              .blockers.includes("ASSET_TIMESTAMP_INVALID"),
          );
          await db.update(assets).set({ createdAt }).where(eq(assets.id, legacy.assetId));
          await db.update(jobs).set({ status: "failed" }).where(eq(jobs.id, legacy.id));
          assert.ok(
            (await inspectExportRetention(connection, target)).entries
              .find((e) => e.assetId === legacy.assetId)!
              .blockers.includes("EXPORT_NOT_READY"),
          );
          await db.update(jobs).set({ status: "ready" }).where(eq(jobs.id, legacy.id));
        },
      );
      await t.test(
        "post-inventory asset, reservation and privacy changes invalidate the proposal fingerprint",
        async () => {
          const first = await inspectExportRetention(connection, target);
          await db
            .update(assets)
            .set({ checksum: "c".repeat(64) })
            .where(eq(assets.id, legacy.assetId));
          const second = await inspectExportRetention(connection, target);
          assert.notEqual(first.fingerprint, second.fingerprint);
          await db.update(objects).set({ queueId: randomUUID() }).where(eq(objects.objectKey, legacy.key));
          const third = await inspectExportRetention(connection, target);
          assert.notEqual(second.fingerprint, third.fingerprint);
          assert.equal(
            proposeExportRetention(third, options).changes.some((c) => c.assetId === legacy.assetId),
            false,
          );
          await db
            .update(valoPrivacyCases)
            .set({ status: "rejected", version: 99 })
            .where(eq(valoPrivacyCases.id, cases[0]!));
          const fourth = await inspectExportRetention(connection, target);
          assert.notEqual(third.fingerprint, fourth.fingerprint);
          assert.equal(
            proposeExportRetention(fourth, options).changes.some((c) => c.assetId === privateAsset.assetId),
            false,
            "unverified rejected state cannot release privacy exclusion",
          );
        },
      );
      await t.test("invalid durations and past or noncanonical dates cannot create a proposal", async () => {
        const inventory = await inspectExportRetention(connection, target);
        for (const retentionDays of [0, -1, 366, 1.5, NaN])
          assert.throws(() => proposeExportRetention(inventory, { ...options, retentionDays }));
        for (const graceDays of [0, -1, 366, 1.5, NaN])
          assert.throws(() => proposeExportRetention(inventory, { ...options, graceDays }));
        for (const effectiveAt of ["yesterday", "2000-01-01T00:00:00.000Z", "2090-01-01"])
          assert.throws(() => proposeExportRetention(inventory, { ...options, effectiveAt }));
      });
      await t.test(
        "CLI requires intent, reports pending coverage and redacts connection failures",
        async () => {
          const run = (args: string[], env = process.env) =>
            spawnSync(
              process.execPath,
              ["--import", "tsx", "src/scripts/export-retention-inventory.ts", ...args],
              { env, encoding: "utf8", timeout: 20_000 },
            );
          const guarded = run(["inventory", target.databaseId], {
            ...process.env,
            VALO_RETENTION_INSPECTION: "",
          });
          assert.equal(guarded.status, 1);
          assert.equal(guarded.stdout, "");
          assert.match(guarded.stderr, /RETENTION_INSPECTION_USAGE_REQUIRED/);
          const before = await snapshot(),
            inspected = run(["plan", target.databaseId, options.effectiveAt, "30", "7"], {
              ...process.env,
              VALO_RETENTION_INSPECTION: "read-only",
            });
          assert.equal(inspected.status, 2, inspected.stderr);
          assert.equal(JSON.parse(inspected.stdout).proposal.applied, false);
          assert.deepEqual(await snapshot(), before);
          const failure = run(["inventory", target.databaseId], {
            ...process.env,
            VALO_RETENTION_INSPECTION: "read-only",
            DATABASE_URL: "postgresql://secret-user:secret-value@127.0.0.1:1/private-database",
          });
          assert.equal(failure.status, 1);
          assert.equal(failure.stdout, "");
          assert.equal(failure.stderr.trim(), "RETENTION_INSPECTION_FAILED");
        },
      );
    } finally {
      connection.release();
      if (cases.length) {
        await db.delete(valoPrivacyEvents).where(inArray(valoPrivacyEvents.caseId, cases));
        await db.delete(valoPrivacyCases).where(inArray(valoPrivacyCases.id, cases));
      }
      const ids = actors.map((actor) => actor.workspaceId);
      if (ids.length) {
        for (const table of [
          objects,
          assets,
          valoExportRequests,
          jobs,
          valoEvents,
          valoDocumentRevisions,
          valoDocuments,
          valoMemberships,
          valoSupportTickets,
        ])
          await db.delete(table).where(inArray(table.workspaceId, ids));
        await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, ids));
      }
      await pool.end();
    }
  },
);
