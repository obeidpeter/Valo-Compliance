import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  valoStaffAssignments,
  valoStaffAccessAudit,
} from "@workspace/db";
import { resolveWorkspace, createDocument } from "../../lib/valo-store";
import { syntheticDocument } from "../../lib/valo-test-fixtures";
import {
  createPrivacyCase,
  confirmPrivacyCase,
  simpleStaffPrivacyAction,
  readPrivacyCase,
} from "../../lib/valo-privacy";
import { privateCleanupAuthority } from "../../lib/valo-private-cleanup-authority";
import {
  exportRetentionAt,
  exportIsExpired,
  expireGeneratedExports,
  retireExpiredExport,
} from "./valo-export-retention";
import { readinessQueries } from "../../lib/valo-operations";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const files = new Map<string, Buffer>();
let onRead: (() => Promise<void>) | undefined;
mock.module(new URL("../../lib/valo-private-storage.ts", import.meta.url).href, {
  namedExports: {
    fileChecksum: digest,
    anonymousPrivateFileStatus: async () => 404,
    writePrivateFile: async (key: string, bytes: Buffer) => {
      assert.ok(!files.has(key));
      files.set(key, bytes);
      return { checksum: digest(bytes), size: bytes.length };
    },
    readPrivateFile: async (key: string, expected: string) => {
      const bytes = files.get(key);
      if (!bytes) throw Error("PRIVATE_STORAGE_READ_FAILED");
      assert.equal(digest(bytes), expected);
      await onRead?.();
      return bytes;
    },
    deletePrivateFile: async (key: string) => {
      files.delete(key);
    },
    privateWorkspaceObject: () => {
      throw Error("NATIVE_STORAGE_FORBIDDEN");
    },
  },
});
const { requestExport, getExport, listExports, executeExport, downloadExport, retryExport } =
  await import("./valo-exports");
const { reconcileExportOrphans } = await import("./valo-export-recovery");

test("export expiry policy validates durations and denies the exact deadline", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  assert.equal(exportRetentionAt(start, {}).toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(
    exportRetentionAt(start, { VALO_EXPORT_RETENTION_DAYS: "1" }).getTime() - start.getTime(),
    86_400_000,
  );
  for (const value of ["0", "-1", "1.5", " 30", "30 ", "3650", "366", "Infinity", ""])
    assert.throws(
      () => exportRetentionAt(start, { VALO_EXPORT_RETENTION_DAYS: value }),
      /INVALID_EXPORT_RETENTION/,
    );
  assert.ok(exportIsExpired({ retentionAt: start }, start.getTime()));
  assert.equal(
    exportIsExpired({ retentionAt: null }, start.getTime()),
    false,
    "legacy unassigned retention is never invented",
  );
});

test(
  "expired generated files retire safely and regenerate without changing saved or financial history",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 90000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    assert.ok(
      !Object.entries(process.env).some(([key, value]) => key.startsWith("REPLIT_DEPLOYMENT") && value),
    );
    const owners: Awaited<ReturnType<typeof resolveWorkspace>>[] = [],
      cases: string[] = [],
      staff: string[] = [];
    const owner = async () => {
      const actor = await resolveWorkspace("synthetic-retention-" + randomUUID());
      owners.push(actor);
      return actor;
    };
    const seed = async (
      actor: Awaited<ReturnType<typeof owner>>,
      retentionAt: Date | null = new Date(0),
      keyOverride?: string,
    ) => {
      const doc = await createDocument(actor, structuredClone(syntheticDocument));
      const requested = await requestExport(actor, doc.id, randomUUID(), {
        revisionId: doc.revisionId,
        format: "docx",
        acknowledgeDraft: true,
      });
      const { job } = await getExport(actor, requested.id),
        assetId = randomUUID(),
        key = keyOverride ?? `valo/development/${actor.workspaceId}/${assetId}.docx`,
        bytes = Buffer.from("synthetic retention fixture");
      await db.insert(objects).values({
        objectKey: key,
        workspaceId: actor.workspaceId,
        jobId: job.id,
        queueId: job.queueId,
        state: "retained",
        nextCleanupAt: new Date(0),
      });
      await db.insert(assets).values({
        id: assetId,
        workspaceId: actor.workspaceId,
        jobId: job.id,
        objectKey: key,
        checksum: digest(bytes),
        size: bytes.length,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        retentionAt,
      });
      await db.update(jobs).set({ status: "ready" }).where(eq(jobs.id, job.id));
      files.set(key, bytes);
      return { doc, job: { ...job, status: "ready" as const }, key, assetId };
    };
    const hold = async (actor: Awaited<ReturnType<typeof owner>>) => {
      const operator = {
          identityId: "synthetic-retention-privacy-" + randomUUID(),
          recentMfa: true,
          verifiedAt: Date.now(),
        },
        reason = "Synthetic retention privacy hold regression; no customer data.";
      staff.push(operator.identityId);
      await db.insert(valoStaffAssignments).values({
        id: randomUUID(),
        identityId: operator.identityId,
        role: "privacy",
        grantedBy: "synthetic",
        reason,
      });
      const request = await createPrivacyCase(actor, "synthetic@example.invalid", {
          kind: "deletion",
          idempotencyKey: randomUUID(),
          message: reason,
          acknowledgement: true,
        }),
        id = request.reference.slice(5);
      cases.push(id);
      let detail = await confirmPrivacyCase(actor, id, { expectedVersion: 1, acknowledgement: true });
      detail = await simpleStaffPrivacyAction(operator, id, {
        action: "claim",
        expectedVersion: detail.request.version,
        reason,
      });
      detail = await simpleStaffPrivacyAction(operator, id, {
        action: "hold",
        expectedVersion: detail.request.version,
        reason,
      });
      return { operator, id, detail, reason };
    };
    const financial = async () =>
      Object.fromEntries(
        await Promise.all(
          ["valo_orders", "valo_entitlements", "valo_purchase_outbox", "valo_payment_reconciliations"].map(
            async (table) => {
              const result = await db.execute(
                sql.raw(
                  `SELECT count(*)::int AS n,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM ${table} t`,
                ),
              );
              return [table, result.rows[0]];
            },
          ),
        ),
      );
    const before = await financial();
    try {
      await t.test(
        "download expiry is enforced without waiting for the worker, including during retrieval",
        async () => {
          const actor = await owner(),
            item = await seed(actor, new Date(Date.now() + 60_000));
          assert.ok((await downloadExport(actor, item.job.id)).bytes.length);
          onRead = async () => {
            onRead = undefined;
            await db
              .update(assets)
              .set({ retentionAt: new Date(0) })
              .where(eq(assets.id, item.assetId));
          };
          await assert.rejects(downloadExport(actor, item.job.id), { status: 410 });
          const visible = (await listExports(actor, item.doc.id))[0]!;
          assert.equal(visible.errorCode, "EXPORT_EXPIRED");
          assert.equal(visible.downloadUrl, null);
          const stranger = await owner();
          await assert.rejects(downloadExport(stranger, item.job.id), { status: 404 });
          assert.ok(files.has(item.key));
        },
      );
      await t.test(
        "transaction failure rolls back retirement; repeat and concurrent attempts append one expiry event",
        async () => {
          const actor = await owner(),
            item = await seed(actor),
            { job, asset } = await getExport(actor, item.job.id);
          await assert.rejects(
            db.transaction(async (tx) => {
              assert.ok((await privateCleanupAuthority(tx, actor.workspaceId)).allowed);
              await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
              await retireExpiredExport(tx, job, asset!);
              throw Error("INJECTED_ROLLBACK");
            }),
            /INJECTED_ROLLBACK/,
          );
          assert.ok((await getExport(actor, job.id)).asset);
          assert.equal((await getExport(actor, job.id)).job.status, "ready");
          const results = await Promise.all([
            expireGeneratedExports(actor.workspaceId),
            expireGeneratedExports(actor.workspaceId),
          ]);
          assert.equal(
            results.reduce((n, result) => n + result.expired, 0),
            1,
          );
          assert.equal((await expireGeneratedExports(actor.workspaceId)).expired, 0);
          assert.equal((await getExport(actor, job.id)).asset, null);
          await assert.rejects(downloadExport(actor, job.id), { status: 410 });
          assert.equal(
            (
              await db
                .select()
                .from(valoEvents)
                .where(and(eq(valoEvents.entityId, job.id), eq(valoEvents.action, "export.expired")))
            ).length,
            1,
          );
          assert.equal(
            (
              await db
                .select()
                .from(valoDocumentRevisions)
                .where(eq(valoDocumentRevisions.id, item.doc.revisionId))
            ).length,
            1,
          );
          assert.ok(files.has(item.key), "retirement commits its durable delete intent before provider I/O");
          let fail = true;
          const remove = async (key: string) => {
            if (fail) throw Error("CONTROLLED_STORAGE_FAILURE");
            files.delete(key);
          };
          assert.equal((await reconcileExportOrphans(job.id, remove)).failed, 1);
          assert.ok(files.has(item.key));
          fail = false;
          await db
            .update(objects)
            .set({ nextCleanupAt: new Date(0) })
            .where(eq(objects.objectKey, item.key));
          assert.equal((await reconcileExportOrphans(job.id, remove)).cleaned, 1);
          assert.equal(files.has(item.key), false);
          files.set(item.key, Buffer.from("late synthetic upload"));
          await db
            .update(objects)
            .set({ nextCleanupAt: new Date(0) })
            .where(eq(objects.objectKey, item.key));
          await reconcileExportOrphans(job.id, remove);
          assert.equal(files.has(item.key), false);
          await Promise.all([retryExport(actor, job.id), retryExport(actor, job.id)]);
          const fresh = (await getExport(actor, job.id)).job;
          assert.notEqual(fresh.queueId, job.queueId);
          await executeExport(job.id, actor.workspaceId, job.queueId);
          assert.equal((await getExport(actor, job.id)).job.attempts, 0, "old delivery is fenced");
          await executeExport(job.id, actor.workspaceId, fresh.queueId);
          const regenerated = await getExport(actor, job.id);
          assert.equal(regenerated.job.status, "ready");
          assert.notEqual(regenerated.asset!.objectKey, item.key);
          assert.ok(regenerated.asset!.retentionAt!.getTime() > Date.now() + 29 * 86_400_000);
          assert.ok((await downloadExport(actor, job.id)).bytes.length);
          assert.equal(regenerated.job.sourceHash, job.sourceHash);
          assert.equal(regenerated.job.revisionId, job.revisionId);
        },
      );
      await t.test(
        "authenticated holds preserve expired bytes and history and block regeneration",
        async () => {
          const actor = await owner(),
            item = await seed(actor),
            held = await hold(actor),
            original = await db.transaction((tx) => readPrivacyCase(tx, held.id));
          assert.equal((await expireGeneratedExports(actor.workspaceId)).held, 1);
          assert.ok((await getExport(actor, item.job.id)).asset);
          assert.ok(files.has(item.key));
          await assert.rejects(downloadExport(actor, item.job.id), { status: 410 });
          await assert.rejects(retryExport(actor, item.job.id), { status: 409 });
          assert.deepEqual(await db.transaction((tx) => readPrivacyCase(tx, held.id)), original);
          await simpleStaffPrivacyAction(held.operator, held.id, {
            action: "release_hold",
            expectedVersion: held.detail.request.version,
            reason: held.reason,
          });
          await db
            .update(objects)
            .set({ nextCleanupAt: new Date(0) })
            .where(eq(objects.objectKey, item.key));
          assert.equal((await expireGeneratedExports(actor.workspaceId)).expired, 1);
        },
      );
      await t.test(
        "malformed bindings yield a bounded next batch; unassigned legacy and future dates are preserved",
        async () => {
          const actor = await owner();
          for (let i = 0; i < 6; i++) await seed(actor, new Date(0), `invalid-retention-${randomUUID()}`);
          const valid = await seed(actor, new Date(1)),
            legacy = await seed(actor, null),
            future = await seed(actor, new Date(Date.now() + 60_000));
          assert.equal((await expireGeneratedExports(actor.workspaceId)).failed, 5);
          const next = await expireGeneratedExports(actor.workspaceId);
          assert.equal(next.failed, 1);
          assert.equal(next.expired, 1);
          assert.equal((await getExport(actor, valid.job.id)).asset, null);
          assert.ok((await getExport(actor, legacy.job.id)).asset);
          assert.ok((await getExport(actor, future.job.id)).asset);
          const metric = await pool.query(readinessQueries.exportRetention);
          assert.ok(metric.rows[0].value >= 6, "retry delay does not hide blocked expiry");
        },
      );
      await t.test(
        "a hold added after retirement still stops physical cleanup until explicit release",
        async () => {
          const actor = await owner(),
            item = await seed(actor);
          assert.equal((await expireGeneratedExports(actor.workspaceId)).expired, 1);
          const held = await hold(actor),
            original = await db.transaction((tx) => readPrivacyCase(tx, held.id));
          let deletes = 0;
          const remove = async (key: string) => {
            deletes++;
            files.delete(key);
          };
          assert.equal((await reconcileExportOrphans(item.job.id, remove)).privacyHeld, 1);
          assert.equal(deletes, 0);
          assert.ok(files.has(item.key));
          assert.deepEqual(await db.transaction((tx) => readPrivacyCase(tx, held.id)), original);
          await simpleStaffPrivacyAction(held.operator, held.id, {
            action: "release_hold",
            expectedVersion: held.detail.request.version,
            reason: held.reason,
          });
          assert.equal((await reconcileExportOrphans(item.job.id, remove)).cleaned, 1);
          assert.equal(files.has(item.key), false);
        },
      );
      await t.test(
        "a privacy lock timeout retains its retry reservation while another workspace progresses",
        async () => {
          const actor = await owner(),
            item = await seed(actor),
            held = await hold(actor),
            other = await owner();
          await seed(other);
          const lock = await pool.connect();
          try {
            await lock.query("BEGIN");
            await lock.query("SELECT id FROM valo_privacy_cases WHERE id=$1 FOR UPDATE", [held.id]);
            await assert.rejects(expireGeneratedExports(actor.workspaceId), (error) => {
              const value = error as { code?: string; cause?: { code?: string } };
              return (value.code ?? value.cause?.code) === "55P03";
            });
            const [object] = await db.select().from(objects).where(eq(objects.objectKey, item.key));
            assert.ok(object!.nextCleanupAt.getTime() > Date.now());
            assert.equal((await expireGeneratedExports(other.workspaceId)).expired, 1);
            assert.ok(files.has(item.key));
          } finally {
            await lock.query("ROLLBACK");
            lock.release();
          }
        },
      );
      assert.deepEqual(await financial(), before);
    } finally {
      onRead = undefined;
      if (cases.length) {
        await db.delete(valoPrivacyEvents).where(inArray(valoPrivacyEvents.caseId, cases));
        await db.delete(valoPrivacyCases).where(inArray(valoPrivacyCases.id, cases));
      }
      if (staff.length) {
        await db.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId, staff));
        await db.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId, staff));
      }
      const ids = owners.map((actor) => actor.workspaceId);
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
      files.clear();
      await pool.end();
    }
  },
);
