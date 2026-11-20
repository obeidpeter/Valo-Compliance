import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";
import { withPrivacyCaseLock } from "./valo-erasure-lock";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  valoPrivacyErasureObjects,
  valoPrivacyCases,
  valoPrivacyEvents,
  valoPrivacyTombstones,
  valoWorkspaces,
  valoMemberships,
  valoStaffAssignments,
  valoStaffAccessAudit,
  valoProfileVersions,
  valoDocuments,
  valoDocumentRevisions,
  valoSupportTickets,
  valoEvents,
  valoExportRequests,
  valoFileAssets,
  valoExportObjects,
  valoExportJobs,
  valoWorkspaceExports,
  valoWorkspaceExportAttempts,
} from "@workspace/db";
import { cleanupWorkspaceExports, workspaceExportScratch } from "./valo-workspace-export-jobs";
import { createDocument } from "../../lib/valo-store";
import { resolveWorkspace, saveProfile } from "../workspaces";
import { syntheticDocument, syntheticProfile } from "../../lib/valo-test-fixtures";
import { RENDER_VERSION } from "../../lib/valo-render";
import { createPrivacyCase, confirmPrivacyCase, simpleStaffPrivacyAction } from "./valo-privacy";
import {
  processPrivacyErasure,
  replayErasureObjects,
  replayErasedApplication,
  reconcileErasedObjects,
  closePrivacyErasureLocks,
} from "./valo-privacy-erasure";
import { requestExport, executeExport } from "../exports/valo-exports";
import { reconcileExportOrphans } from "../exports/valo-export-recovery";
import { privacyKeys, privacySigner } from "../../lib/valo-privacy-keys";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { writePrivateFile, readPrivateFile, deletePrivateFile } from "../../platform/valo-private-storage";
import { erasureProofMode } from "../../test-support/erasure-proof-storage";

const reason = "Controlled synthetic erasure race and recovery proof; no production or provider deletion.";
test(
  "erasure holds, bounded recovery and accepted-upload process death",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 180000,
  },
  async (t) => {
    assertDevelopmentRuntime();
    const nativeProof = erasureProofMode(process.env) === "native-replit";
    const owners: string[] = [],
      operators: string[] = [],
      children: ChildProcess[] = [];
    const setup = async () => {
      const run = randomUUID(),
        owner = await resolveWorkspace(`synthetic-erasure-race-${run}`);
      owners.push(owner.workspaceId);
      const actor = {
        identityId: `synthetic-erasure-operator-${run}`,
        recentMfa: true,
        verifiedAt: Date.now(),
      };
      operators.push(actor.identityId);
      await db.insert(valoStaffAssignments).values({
        id: randomUUID(),
        identityId: actor.identityId,
        role: "privacy",
        grantedBy: "synthetic-test",
        reason,
      });
      const document = await createDocument(owner, syntheticDocument);
      const created = await createPrivacyCase(owner, "synthetic@example.invalid", {
        kind: "deletion",
        idempotencyKey: randomUUID(),
        message: reason,
        acknowledgement: true,
      });
      const id = created.reference.slice(5);
      let detail = await confirmPrivacyCase(owner, id, { expectedVersion: 1, acknowledgement: true });
      detail = await simpleStaffPrivacyAction(actor, id, {
        action: "claim",
        expectedVersion: detail.request.version,
        reason,
      });
      return { owner, actor, document, id, version: detail.request.version, started: false };
    };
    type Fixture = Awaited<ReturnType<typeof setup>>;
    const fresh = (f: Fixture) => ({ ...f.actor, verifiedAt: Date.now() });
    const step = async (f: Fixture, remove: (key: string) => Promise<void>) => {
      const detail = await processPrivacyErasure(
        fresh(f),
        f.id,
        {
          action: f.started ? "resume_erasure" : "start_erasure",
          expectedVersion: f.version,
          reason,
          acknowledgement: true,
        },
        remove,
      );
      f.started = true;
      f.version = detail.request.version;
      return detail;
    };
    const finish = async (f: Fixture, remove: (key: string) => Promise<void>) => {
      for (let n = 0; n < 80; n++) {
        const d = await step(f, remove);
        if (d.request.status === "partially_fulfilled") return d;
      }
      throw Error("CONTROLLED_ERASURE_DID_NOT_FINISH");
    };
    const exportJob = async (f: Fixture) => {
      const created = await requestExport(f.owner, f.document.id, randomUUID(), {
        revisionId: f.document.revisionId,
        format: "docx",
        acknowledgeDraft: true,
      });
      const [job] = await db.select().from(valoExportJobs).where(eq(valoExportJobs.id, created.id));
      return job;
    };
    const assertWrongCurrentKey = async (
      run: (remove: (key: string) => Promise<void>) => Promise<unknown>,
      caseId: string,
    ) => {
      const original = process.env.VALO_PRIVACY_KEYRING,
        ring = privacyKeys(),
        current = `synthetic-erasure-key-${randomUUID()}`;
      const pinned = { current, keys: { ...ring.keys, [current]: "controlled-pinned-test-key-".repeat(3) } };
      await db.transaction((tx) => privacySigner(tx, pinned));
      const [before] = await db
        .select()
        .from(valoPrivacyTombstones)
        .where(eq(valoPrivacyTombstones.caseId, caseId));
      assert.ok(before);
      let calls = 0;
      try {
        process.env.VALO_PRIVACY_KEYRING = JSON.stringify({
          ...pinned,
          keys: { ...pinned.keys, [current]: "controlled-wrong-test-key-".repeat(3) },
        });
        await assert.rejects(
          () =>
            run(async () => {
              calls++;
            }),
          { status: 503 },
        );
        assert.equal(calls, 0);
        process.env.VALO_PRIVACY_KEYRING = JSON.stringify({
          current,
          keys: { [current]: pinned.keys[current] },
        });
        await assert.rejects(
          () =>
            run(async () => {
              calls++;
            }),
          { status: 503 },
        );
        assert.equal(calls, 0);
        const [after] = await db
          .select()
          .from(valoPrivacyTombstones)
          .where(eq(valoPrivacyTombstones.caseId, caseId));
        assert.ok(after);
        assert.deepEqual(after.replayState, before.replayState);
      } finally {
        if (original === undefined) delete process.env.VALO_PRIVACY_KEYRING;
        else process.env.VALO_PRIVACY_KEYRING = original;
        await db.execute(sql`DELETE FROM valo_privacy_key_versions WHERE id=${current}`);
      }
    };
    const ownedScratch: string[] = [];
    try {
      await t.test(
        "ordinary orphan and temporary cleanup never bypass privacy-owned complete or invalid cases",
        async () => {
          const f = await setup(),
            job = await exportJob(f),
            objects = new Map<string, Buffer>();
          await executeExport(job!.id, f.owner.workspaceId, job!.queueId!, undefined, {
            write: async (key, bytes) => {
              objects.set(key, bytes);
              return { checksum: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
            },
            remove: async (key) => {
              objects.delete(key);
            },
          });
          const [tracked] = await db
            .select()
            .from(valoExportObjects)
            .where(eq(valoExportObjects.jobId, job!.id));
          assert.ok(tracked);
          const [originalDocument] = await db
            .select()
            .from(valoDocuments)
            .where(eq(valoDocuments.id, job!.documentId));
          assert.ok(originalDocument);
          const originalRevisions = await db
            .select()
            .from(valoDocumentRevisions)
            .where(eq(valoDocumentRevisions.documentId, job!.documentId));
          const exportId = randomUUID(),
            attemptId = randomUUID(),
            tempKey = `valo/development/${f.owner.workspaceId}/${randomUUID()}.json`;
          const [workspaceJob] = await db
            .insert(valoWorkspaceExports)
            .values({
              id: exportId,
              workspaceId: f.owner.workspaceId,
              requesterId: f.owner.identityId,
              requestKey: randomUUID(),
              status: "expired",
              expiresAt: new Date(0),
            })
            .returning();
          assert.ok(workspaceJob);
          const [attempt] = await db
            .insert(valoWorkspaceExportAttempts)
            .values({
              id: attemptId,
              workspaceId: f.owner.workspaceId,
              jobId: exportId,
              objectKey: tempKey,
              status: "cleanup",
            })
            .returning();
          assert.ok(attempt);
          const scratch = workspaceExportScratch(attemptId);
          ownedScratch.push(scratch);
          await mkdir(scratch, { recursive: true });
          await writeFile(join(scratch, "owned-synthetic.txt"), "OWNED_SYNTHETIC_SCRATCH");
          let calls = 0;
          const remove = async (key: string) => {
            calls++;
            objects.delete(key);
          };
          const storage = {
            put: async () => {
              throw Error("UNEXPECTED_UPLOAD");
            },
            get: async () => {
              throw Error("UNEXPECTED_READ");
            },
            remove,
          };
          const blocked = async (label: string) => {
            // Make each authority state independently due despite durable retry backoff.
            await db
              .update(valoWorkspaceExportAttempts)
              .set({ nextCleanupAt: new Date(0) })
              .where(eq(valoWorkspaceExportAttempts.id, attemptId));
            await db
              .update(valoExportObjects)
              .set({ state: "cleanup", nextCleanupAt: new Date(0) })
              .where(eq(valoExportObjects.objectKey, tracked.objectKey));
            const orphan = await reconcileExportOrphans(job!.id, remove);
            const temporary = await cleanupWorkspaceExports(storage, f.owner.workspaceId);
            assert.equal(orphan.privacyHeld, 1, label);
            assert.equal(temporary.privacyHeld, 1, label);
            assert.equal(calls, 0, label);
            assert.equal(
              await readFile(join(scratch, "owned-synthetic.txt"), "utf8"),
              "OWNED_SYNTHETIC_SCRATCH",
              label,
            );
          };
          await step(f, async () => {});
          await blocked("incomplete");
          await finish(f, async () => {});
          // Converged erasure removes both tracking families. Restore their exact
          // older-checkpoint rows to prove ordinary cleanup still defers to the
          // retained signed privacy authority after a database restore.
          await db.insert(valoDocuments).values(originalDocument);
          await db.insert(valoDocumentRevisions).values(originalRevisions);
          await db.insert(valoExportJobs).values(job!);
          await db.insert(valoExportObjects).values(tracked);
          assert.equal(
            (await db.select().from(valoWorkspaceExports).where(eq(valoWorkspaceExports.id, workspaceJob.id)))
              .length,
            0,
          );
          assert.equal(
            (
              await db
                .select()
                .from(valoWorkspaceExportAttempts)
                .where(eq(valoWorkspaceExportAttempts.id, attempt.id))
            ).length,
            0,
          );
          await db.insert(valoWorkspaceExports).values(workspaceJob);
          await db.insert(valoWorkspaceExportAttempts).values(attempt);
          // The authorized erasure correctly removed scratch. Recreate this
          // synthetic local copy as part of the older-checkpoint restore fixture.
          await mkdir(scratch, { recursive: true });
          await writeFile(join(scratch, "owned-synthetic.txt"), "OWNED_SYNTHETIC_SCRATCH");
          const [c] = await db.select().from(valoPrivacyCases).where(eq(valoPrivacyCases.id, f.id));
          assert.ok(c);
          const [tomb] = await db
            .select()
            .from(valoPrivacyTombstones)
            .where(eq(valoPrivacyTombstones.caseId, f.id));
          assert.ok(tomb);
          await blocked("completed-owned-scope");
          await db.update(valoPrivacyCases).set({ status: "held" }).where(eq(valoPrivacyCases.id, f.id));
          try {
            await blocked("held");
          } finally {
            await db.update(valoPrivacyCases).set({ status: c.status }).where(eq(valoPrivacyCases.id, f.id));
          }
          await db
            .update(valoPrivacyTombstones)
            .set({ erasureSeal: { ...tomb.erasureSeal!, mac: "0".repeat(64) } })
            .where(eq(valoPrivacyTombstones.caseId, f.id));
          try {
            await blocked("tampered");
          } finally {
            await db
              .update(valoPrivacyTombstones)
              .set({ erasureSeal: tomb.erasureSeal })
              .where(eq(valoPrivacyTombstones.caseId, f.id));
          }
          const original = process.env.VALO_PRIVACY_KEYRING,
            ring = privacyKeys();
          try {
            process.env.VALO_PRIVACY_KEYRING = JSON.stringify({
              ...ring,
              keys: { ...ring.keys, [ring.current]: "wrong-synthetic-key-".repeat(4) },
            });
            await blocked("wrong-key");
            const absent = "absent-" + randomUUID();
            process.env.VALO_PRIVACY_KEYRING = JSON.stringify({
              current: absent,
              keys: { [absent]: "new-synthetic-key-".repeat(4) },
            });
            await blocked("missing-historical-key");
          } finally {
            if (original === undefined) delete process.env.VALO_PRIVACY_KEYRING;
            else process.env.VALO_PRIVACY_KEYRING = original;
          }
          t.diagnostic(
            "Both ordinary cleanup paths deferred all six privacy-owned states with zero storage or scratch deletions.",
          );
          const ordinary = await setup(),
            ordinaryJob = randomUUID(),
            ordinaryAttempt = randomUUID(),
            ordinaryKey = `valo/development/${ordinary.owner.workspaceId}/${ordinaryAttempt}.json`;
          await db.insert(valoWorkspaceExports).values({
            id: ordinaryJob,
            workspaceId: ordinary.owner.workspaceId,
            requesterId: ordinary.owner.identityId,
            requestKey: randomUUID(),
            status: "expired",
            expiresAt: new Date(0),
          });
          await db.insert(valoWorkspaceExportAttempts).values({
            id: ordinaryAttempt,
            workspaceId: ordinary.owner.workspaceId,
            jobId: ordinaryJob,
            objectKey: ordinaryKey,
            status: "cleanup",
          });
          objects.set(ordinaryKey, Buffer.from("NEW_SYNTHETIC_TEMPORARY_BYTES"));
          const positive = await cleanupWorkspaceExports(storage, ordinary.owner.workspaceId);
          assert.equal(positive.privacyHeld, 0);
          assert.equal(positive.failed, 0);
          assert.equal(calls, 1);
          assert.equal(objects.has(ordinaryKey), false);
          assert.equal(objects.has(tracked.objectKey), true, "Owned deferred bytes must remain untouched");
        },
      );
      await t.test(
        "13 objects and 205 restored profile rows resume across killed workers without repeated object traversal",
        async () => {
          const f = await setup();
          await saveProfile(f.owner, { expectedRevision: 0, profile: syntheticProfile });
          const [profile] = await db
            .select()
            .from(valoProfileVersions)
            .where(eq(valoProfileVersions.workspaceId, f.owner.workspaceId));
          assert.ok(profile);
          const keys = Array.from(
            { length: 13 },
            () => `valo/development/${f.owner.workspaceId}/${randomUUID()}.docx`,
          ).sort();
          await db
            .insert(valoPrivacyErasureObjects)
            .values(keys.map((objectKey) => ({ caseId: f.id, workspaceId: f.owner.workspaceId, objectKey })));
          await finish(f, async () => {});
          await db
            .update(valoPrivacyTombstones)
            .set({ nextReplayAt: new Date(Date.now() + 3_600_000) })
            .where(eq(valoPrivacyTombstones.caseId, f.id));
          await db
            .insert(valoProfileVersions)
            .values(
              Array.from({ length: 205 }, (_, i) => ({ ...profile, id: randomUUID(), revision: i + 1 })),
            );
          type Batch = {
            type: string;
            message?: string;
            keys: string[];
            result: { deleted: number; applicationRowsRemoved: number; remaining: boolean };
            verification: { fullScans: number; cacheHits: number };
          };
          const start = async () => {
            const child = spawn(
              process.execPath,
              [
                "--import",
                "tsx",
                fileURLToPath(new URL("../../scripts/erasure-replay-batch-child.ts", import.meta.url)),
              ],
              {
                env: { ...process.env, VALO_ERASURE_BATCH_CHILD: "new-synthetic-fixture-only" },
                stdio: ["ignore", "ignore", "pipe", "ipc"],
              },
            );
            children.push(child);
            const [ready] = await once(child, "message", { signal: AbortSignal.timeout(20000) });
            assert.equal(ready.type, "ready");
            return child;
          };
          const next = async (child: ChildProcess) => {
            const message = once(child, "message", { signal: AbortSignal.timeout(20000) });
            child.send!({ caseId: f.id });
            const [raw] = await message;
            const result = raw as Batch;
            assert.equal(result.type, "batch", result.message);
            assert.ok(result.keys.length <= 10);
            assert.ok(result.result.applicationRowsRemoved <= 100);
            assert.equal(result.verification.fullScans, 1);
            return result;
          };
          const kill = async (child: ChildProcess) => {
            const exit = once(child, "exit");
            child.kill("SIGKILL");
            await exit;
          };
          const deleted: string[] = [];
          let child = await start(),
            batch = await next(child);
          deleted.push(...batch.keys);
          assert.equal(batch.keys.length, 10);
          await kill(child);
          child = await start();
          batch = await next(child);
          deleted.push(...batch.keys);
          assert.equal(batch.keys.length, 3);
          let removed = 0;
          for (let i = 0; i < 25 && removed === 0; i++) {
            batch = await next(child);
            deleted.push(...batch.keys);
            removed += batch.result.applicationRowsRemoved;
          }
          assert.equal(removed, 100);
          await kill(child);
          child = await start();
          for (let i = 0; i < 40; i++) {
            batch = await next(child);
            deleted.push(...batch.keys);
            removed += batch.result.applicationRowsRemoved;
            if (!batch.result.remaining) break;
          }
          assert.equal(batch.result.remaining, false);
          assert.equal(removed, 205);
          assert.deepEqual(deleted.sort(), keys);
          assert.equal(new Set(deleted).size, 13);
          assert.ok(batch.verification.cacheHits > 10);
          assert.equal(
            (
              await db
                .select()
                .from(valoProfileVersions)
                .where(eq(valoProfileVersions.workspaceId, f.owner.workspaceId))
            ).length,
            0,
          );
          t.diagnostic(
            JSON.stringify({
              boundedReplay: {
                objects: 13,
                deleteCalls: deleted.length,
                duplicateDeletes: 0,
                restoredProfiles: 205,
                removedProfiles: removed,
                killedWorkers: 2,
                maxObjectsPerBatch: 10,
                maxRowsPerBatch: 100,
                finalWorkerFullInventoryChecks: batch.verification.fullScans,
                finalWorkerCachedChecks: batch.verification.cacheHits,
              },
            }),
          );
          const stopped = once(child, "exit");
          child.send!("stop");
          await stopped;
        },
      );
      await t.test(
        "application replay authenticates the entire inventory and case before revocation or profile deletion",
        async () => {
          const f = await setup(),
            key = `valo/development/${f.owner.workspaceId}/${randomUUID()}.docx`,
            altered = `valo/development/${f.owner.workspaceId}/${randomUUID()}.docx`;
          await saveProfile(f.owner, { expectedRevision: 0, profile: syntheticProfile });
          const [profile] = await db
            .select()
            .from(valoProfileVersions)
            .where(eq(valoProfileVersions.workspaceId, f.owner.workspaceId));
          assert.ok(profile);
          await db
            .insert(valoPrivacyErasureObjects)
            .values({ workspaceId: f.owner.workspaceId, caseId: f.id, objectKey: key });
          await finish(f, async () => {});
          for (let n = 0; n < 12; n++) {
            const [tomb] = await db
              .select()
              .from(valoPrivacyTombstones)
              .where(eq(valoPrivacyTombstones.caseId, f.id));
            assert.ok(tomb);
            if ((tomb.replayState as { phase?: unknown } | null)?.phase === 10) break;
            await replayErasedApplication(f.id, async () => {});
          }
          const [tomb] = await db
            .select()
            .from(valoPrivacyTombstones)
            .where(eq(valoPrivacyTombstones.caseId, f.id));
          assert.ok(tomb);
          assert.equal((tomb.replayState as { phase: unknown }).phase, 10); // v3 profile-deletion phase.
          await db.insert(valoProfileVersions).values(profile);
          await db
            .update(valoMemberships)
            .set({ active: "yes" })
            .where(eq(valoMemberships.workspaceId, f.owner.workspaceId));
          // Simulate a corrupt restored inventory in one atomic DDL transaction.
          // The trigger is never disabled for concurrent sessions or other rows.
          const replaceKey = (from: string, to: string) =>
            db.transaction(async (tx) => {
              await tx.execute(
                sql`ALTER TABLE valo_privacy_erasure_objects DISABLE TRIGGER valo_erasure_inventory_immutable`,
              );
              const result = await tx.execute(sql`UPDATE valo_privacy_erasure_objects SET object_key=${to}
          WHERE workspace_id=${f.owner.workspaceId}::uuid AND case_id=${f.id}::uuid AND object_key=${from}`);
              assert.equal(result.rowCount, 1);
              await tx.execute(
                sql`ALTER TABLE valo_privacy_erasure_objects ENABLE TRIGGER valo_erasure_inventory_immutable`,
              );
            });
          let calls = 0;
          const intact = async () => {
            assert.equal(
              (await db.select().from(valoProfileVersions).where(eq(valoProfileVersions.id, profile.id)))
                .length,
              1,
            );
            const [m] = await db
              .select()
              .from(valoMemberships)
              .where(eq(valoMemberships.workspaceId, f.owner.workspaceId));
            assert.ok(m);
            assert.equal(m.active, "yes");
            assert.equal(calls, 0);
          };
          await replaceKey(key, altered);
          try {
            await assert.rejects(() =>
              replayErasedApplication(f.id, async () => {
                calls++;
              }),
            );
            await intact();
          } finally {
            await replaceKey(altered, key);
          }
          const emptyKey = (insert: boolean) =>
            db.transaction(async (tx) => {
              await tx.execute(
                sql`ALTER TABLE valo_privacy_erasure_objects DISABLE TRIGGER valo_erasure_inventory_immutable`,
              );
              if (insert)
                await tx.execute(sql`INSERT INTO valo_privacy_erasure_objects(workspace_id,case_id,object_key)
          VALUES(${f.owner.workspaceId}::uuid,${f.id}::uuid,'')`);
              else
                await tx.execute(
                  sql`DELETE FROM valo_privacy_erasure_objects WHERE case_id=${f.id}::uuid AND object_key=''`,
                );
              await tx.execute(
                sql`ALTER TABLE valo_privacy_erasure_objects ENABLE TRIGGER valo_erasure_inventory_immutable`,
              );
            });
          await emptyKey(true);
          try {
            await assert.rejects(() =>
              replayErasedApplication(f.id, async () => {
                calls++;
              }),
            );
            await intact();
          } finally {
            await emptyKey(false);
          }
          const [original] = await db.select().from(valoPrivacyCases).where(eq(valoPrivacyCases.id, f.id));
          assert.ok(original);
          await db
            .update(valoPrivacyCases)
            .set({ message: "Corrupted synthetic restored case." })
            .where(eq(valoPrivacyCases.id, f.id));
          try {
            await assert.rejects(
              () =>
                replayErasedApplication(f.id, async () => {
                  calls++;
                }),
              { status: 409 },
            );
            await intact();
          } finally {
            await db
              .update(valoPrivacyCases)
              .set({ message: original.message })
              .where(eq(valoPrivacyCases.id, f.id));
          }
        },
      );
      await t.test("distinct advisory locks cannot exhaust a one-connection shared data pool", async () => {
        const data = new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 1,
          connectionTimeoutMillis: 1000,
          allowExitOnIdle: true,
        });
        const locks = new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 2,
          connectionTimeoutMillis: 1000,
          allowExitOnIdle: true,
        });
        try {
          const results = await Promise.all(
            Array.from({ length: 6 }, () =>
              withPrivacyCaseLock(locks, randomUUID(), async () => {
                const config = { text: "SELECT 1 AS value", query_timeout: 1000 };
                const r = await data.query(config);
                return r.rows[0].value;
              }),
            ),
          );
          assert.deepEqual(results, [1, 1, 1, 1, 1, 1]);
        } finally {
          await locks.end();
          await data.end();
        }
      });
      await t.test(
        "holds and revoked roles stop the next object, while an in-flight result remains recorded",
        async () => {
          const f = await setup(),
            keys = Array.from(
              { length: 23 },
              () => `valo/development/${f.owner.workspaceId}/${randomUUID()}.pdf`,
            ).sort();
          await db
            .insert(valoPrivacyErasureObjects)
            .values(keys.map((objectKey) => ({ caseId: f.id, workspaceId: f.owner.workspaceId, objectKey })));
          await db
            .insert(valoDocuments)
            .values(
              Array.from({ length: 205 }, () => ({ id: randomUUID(), workspaceId: f.owner.workspaceId })),
            );
          await step(f, async () => {});
          await assertWrongCurrentKey((remove) => step(f, remove), f.id);
          let dispatched = 0,
            heldVersion = 0;
          await assert.rejects(
            () =>
              step(f, async () => {
                dispatched++;
                if (dispatched === 1) {
                  const held = await simpleStaffPrivacyAction(fresh(f), f.id, {
                    action: "hold",
                    expectedVersion: f.version,
                    reason,
                  });
                  heldVersion = held.request.version;
                }
              }),
            { status: 409 },
          );
          assert.equal(dispatched, 1);
          assert.equal(
            (
              await db
                .select()
                .from(valoPrivacyErasureObjects)
                .where(eq(valoPrivacyErasureObjects.caseId, f.id))
            ).filter((x) => x.status === "deleted").length,
            1,
          );
          f.version = heldVersion;
          await assert.rejects(
            () =>
              simpleStaffPrivacyAction(fresh(f), f.id, {
                action: "claim",
                expectedVersion: f.version,
                reason,
              }),
            { status: 409 },
          );
          const resumed = await simpleStaffPrivacyAction(fresh(f), f.id, {
            action: "release_hold",
            expectedVersion: f.version,
            reason,
          });
          assert.equal(resumed.request.status, "in_progress");
          f.version = resumed.request.version;
          let revokedCalls = 0;
          await assert.rejects(
            () =>
              step(f, async () => {
                revokedCalls++;
                await db
                  .update(valoStaffAssignments)
                  .set({ active: false })
                  .where(eq(valoStaffAssignments.identityId, f.actor.identityId));
              }),
            { status: 403 },
          );
          assert.equal(revokedCalls, 1);
          assert.equal(
            (
              await db
                .select()
                .from(valoPrivacyErasureObjects)
                .where(eq(valoPrivacyErasureObjects.caseId, f.id))
            ).filter((x) => x.status === "deleted").length,
            2,
          );
          await db
            .update(valoStaffAssignments)
            .set({ active: true })
            .where(eq(valoStaffAssignments.identityId, f.actor.identityId));
          await finish(f, async () => {});
          // Create persisted object progress before replacing only the current signer.
          const initial = await replayErasureObjects(f.id, async () => {});
          assert.equal(initial.deleted, 10);
          await assertWrongCurrentKey((remove) => replayErasureObjects(f.id, remove), f.id);
          for (let n = 0; n < 4; n++) {
            const r = await replayErasureObjects(f.id, async () => {});
            if (!r.remaining) break;
          }
          // Simulate restored application rows after importing the retained journal.
          await db
            .insert(valoDocuments)
            .values(
              Array.from({ length: 235 }, () => ({ id: randomUUID(), workspaceId: f.owner.workspaceId })),
            );
          const replayed: string[] = [];
          let complete = false,
            totalRows = 0;
          for (let n = 0; n < 40; n++) {
            const result = await replayErasedApplication(f.id, async (key) => {
              replayed.push(key);
            });
            assert.ok(result.deleted <= 10);
            assert.ok(result.applicationRowsRemoved <= 100);
            totalRows += result.applicationRowsRemoved;
            if (!result.remaining) {
              complete = true;
              break;
            }
          }
          assert.equal(complete, true);
          assert.equal(totalRows, 235);
          assert.deepEqual(replayed, keys, "application batches must not restart the completed object phase");
          assert.equal(
            (await db.select().from(valoDocuments).where(eq(valoDocuments.workspaceId, f.owner.workspaceId)))
              .length,
            0,
          );
        },
      );
      await t.test(
        "actual export worker cleans an upload finishing after its tracking/job rows were erased",
        async () => {
          const f = await setup(),
            job = await exportJob(f),
            objects = new Map<string, Buffer>();
          let release!: () => void,
            accepted!: (key: string) => void,
            uploaded = false,
            lateCleanup = false;
          const barrier = new Promise<void>((r) => {
              release = r;
            }),
            ready = new Promise<string>((r) => {
              accepted = r;
            });
          const running = executeExport(job!.id, f.owner.workspaceId, job!.queueId!, undefined, {
            write: async (key, bytes, onUploading) => {
              await onUploading?.();
              accepted(key);
              await barrier;
              objects.set(key, bytes);
              uploaded = true;
              return { checksum: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
            },
            remove: async (key) => {
              if (uploaded) lateCleanup = true;
              objects.delete(key);
            },
          }).then(
            () => ({ ok: true, error: null }),
            (error) => ({ ok: false, error }),
          );
          const key = await Promise.race([
            ready,
            running.then(() => {
              throw Error("Export failed before reaching the controlled upload barrier.");
            }),
          ]);
          try {
            await step(f, async (object) => {
              objects.delete(object);
            });
            let orphanCalls = 0;
            const incomplete = await reconcileExportOrphans(job!.id, async () => {
              orphanCalls++;
            });
            assert.equal(orphanCalls, 0);
            assert.equal(incomplete.privacyHeld, 1);
            await db
              .update(valoExportObjects)
              .set({ nextCleanupAt: new Date(0) })
              .where(eq(valoExportObjects.jobId, job!.id));
            const [before] = await db
              .select()
              .from(valoPrivacyTombstones)
              .where(eq(valoPrivacyTombstones.caseId, f.id));
            assert.ok(before);
            try {
              await db
                .update(valoPrivacyTombstones)
                .set({ erasureSeal: { ...before.erasureSeal, mac: "0".repeat(64) } })
                .where(eq(valoPrivacyTombstones.caseId, f.id));
              const corrupt = await reconcileExportOrphans(job!.id, async () => {
                orphanCalls++;
              });
              assert.equal(orphanCalls, 0);
              assert.equal(corrupt.privacyHeld, 1);
            } finally {
              await db
                .update(valoPrivacyTombstones)
                .set({ erasureSeal: before.erasureSeal })
                .where(eq(valoPrivacyTombstones.caseId, f.id));
            }
            await db
              .update(valoExportObjects)
              .set({ nextCleanupAt: new Date(0) })
              .where(eq(valoExportObjects.jobId, job!.id));
            const held = await simpleStaffPrivacyAction(fresh(f), f.id, {
              action: "hold",
              expectedVersion: f.version,
              reason,
            });
            f.version = held.request.version;
            const heldCleanup = await reconcileExportOrphans(job!.id, async () => {
              orphanCalls++;
            });
            assert.equal(orphanCalls, 0);
            assert.equal(heldCleanup.privacyHeld, 1);
            const released = await simpleStaffPrivacyAction(fresh(f), f.id, {
              action: "release_hold",
              expectedVersion: f.version,
              reason,
            });
            f.version = released.request.version;
            await finish(f, async (object) => {
              objects.delete(object);
            });
            assert.equal(
              (await db.select().from(valoExportJobs).where(eq(valoExportJobs.id, job!.id))).length,
              0,
            );
            assert.equal(
              (await db.select().from(valoExportObjects).where(eq(valoExportObjects.objectKey, key))).length,
              0,
            );
          } finally {
            release();
          }
          const result = await running;
          assert.equal(result.ok, false);
          assert.equal(lateCleanup, false);
          assert.equal(objects.size, 1, "privacy-owned cleanup must pass the signed-case gate");
          const cleanup = await reconcileErasedObjects(async (key) => {
            lateCleanup = true;
            objects.delete(key);
          }, f.id);
          assert.equal(cleanup.cleaned, 1);
          assert.equal(cleanup.held, 0);
          assert.equal(lateCleanup, true);
          assert.equal(objects.size, 0);
          assert.equal(
            (
              await db
                .select()
                .from(valoPrivacyErasureObjects)
                .where(eq(valoPrivacyErasureObjects.caseId, f.id))
            ).length,
            1,
          );
        },
      );
      await t.test(
        "native private upload spans complete erasure and is removed by automatic maintenance",
        {
          skip: !nativeProof
            ? "Native-provider lane not selected; portable race/recovery checks remain active."
            : false,
        },
        async () => {
          const f = await setup(),
            job = await exportJob(f);
          let release!: () => void,
            accepted!: (key: string) => void,
            key = "",
            checksum = "";
          const barrier = new Promise<void>((r) => {
              release = r;
            }),
            reached = new Promise<string>((r) => {
              accepted = r;
            });
          const running = executeExport(job!.id, f.owner.workspaceId, job!.queueId, undefined, {
            write: async (k, bytes, beforeWrite) => {
              key = k;
              await beforeWrite?.();
              accepted(k);
              await barrier;
              const stored = await writePrivateFile(k, bytes);
              checksum = stored.checksum;
              return stored;
            },
            remove: deletePrivateFile,
          }).then(
            () => null,
            (error) => error,
          );
          try {
            await Promise.race([
              reached,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(Error("NATIVE_UPLOAD_BARRIER_NOT_REACHED")), 15000).unref(),
              ),
            ]);
            await finish(f, deletePrivateFile);
            assert.equal(
              (await db.select().from(valoExportJobs).where(eq(valoExportJobs.id, job!.id))).length,
              0,
            );
            release();
            assert.ok((await running) instanceof Error);
            await readPrivateFile(key, checksum); // Correct checksum proves actual late bytes existed.
            const result = await reconcileExportOrphans(undefined, deletePrivateFile, {
              workspaceId: f.owner.workspaceId,
              caseId: f.id,
            });
            assert.equal(result.failed, 0);
            assert.equal(result.privacyHeld, 0);
            assert.equal(result.cleaned, 1);
            await assert.rejects(() => readPrivateFile(key, checksum));
          } finally {
            release();
            await running;
            if (key) await deletePrivateFile(key);
          }
        },
      );
      await t.test(
        "SIGKILL before upload acknowledgement leaves a durable automatic late-write cleanup path",
        async () => {
          const f = await setup(),
            objects = new Map<string, Buffer>();
          const [revision] = await db
            .select()
            .from(valoDocumentRevisions)
            .where(eq(valoDocumentRevisions.id, f.document.revisionId));
          assert.ok(revision);
          // Isolate the subprocess fixture from the always-on development queued
          // dispatcher. This valid retry state still uses unmodified executeExport;
          // customer queue creation is exercised by the other export tests.
          const job = {
            id: randomUUID(),
            workspaceId: f.owner.workspaceId,
            documentId: f.document.id,
            revisionId: revision.id,
            revision: revision.revision,
            format: "docx" as const,
            renderVersion: RENDER_VERSION,
            sourceHash: revision.contentHash,
            requestedBy: f.owner.identityId,
            queueId: randomUUID(),
            status: "retrying" as const,
          };
          await db.insert(valoExportJobs).values(job);
          const child = fork(
            fileURLToPath(new URL("../../scripts/erasure-upload-crash-child.ts", import.meta.url)),
            [job.id, f.owner.workspaceId, job.queueId],
            {
              execArgv: ["--import", "tsx"],
              env: { ...process.env, VALO_ERASURE_CRASH_CHILD: "controlled-synthetic-only" },
              stdio: ["ignore", "pipe", "pipe", "ipc"],
            },
          );
          children.push(child);
          child.stderr?.resume();
          child.stdout?.resume();
          const accepted = await new Promise<{ key: string; bytes: string }>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(Error("Controlled upload child did not reach the accepted barrier.")),
              30000,
            );
            child.once("error", (e) => {
              clearTimeout(timeout);
              reject(e);
            });
            child.once("exit", (code) => {
              clearTimeout(timeout);
              reject(Error("Controlled upload child exited before its barrier; code " + String(code)));
            });
            child.on("message", (raw) => {
              const m = raw as { stage?: string; key?: string; bytes?: string; errorCode?: string };
              if (m.stage === "worker_returned") {
                clearTimeout(timeout);
                reject(Error("Controlled worker returned before upload barrier: " + m.errorCode));
              }
              if (m.stage === "upload_accepted" && m.key && m.bytes) {
                clearTimeout(timeout);
                resolve({ key: m.key, bytes: m.bytes });
              }
            });
          });
          await finish(f, async (key) => {
            objects.delete(key);
          });
          const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
          child.kill("SIGKILL");
          await exited;
          assert.equal(child.signalCode, "SIGKILL");
          // The controlled object service completes a request accepted before the
          // client process died. No catch/finally in that client can clean it up.
          let checksum = "";
          const native = nativeProof;
          t.diagnostic(
            native
              ? "Killed-upload completion used native private App Storage."
              : "Killed-upload completion used controlled object transport; native storage unconfigured.",
          );
          if (native) {
            checksum = (await writePrivateFile(accepted.key, Buffer.from(accepted.bytes, "base64"))).checksum;
            await readPrivateFile(accepted.key, checksum);
          } else objects.set(accepted.key, Buffer.from(accepted.bytes, "base64"));
          try {
            const [scheduled] = await db
              .select()
              .from(valoPrivacyTombstones)
              .where(eq(valoPrivacyTombstones.caseId, f.id));
            assert.ok(scheduled);
            assert.ok(scheduled.nextReplayAt.getTime() <= Date.now() + 3_600_000);
            // Advance only this new fixture's persisted scheduler clock. An
            // unknown upload's hourly rescan is not an immediate completion signal.
            await db
              .update(valoPrivacyTombstones)
              .set({ nextReplayAt: new Date(0) })
              .where(eq(valoPrivacyTombstones.caseId, f.id));
            const result = await reconcileExportOrphans(
              undefined,
              native
                ? deletePrivateFile
                : async (key) => {
                    objects.delete(key);
                  },
              { workspaceId: f.owner.workspaceId, caseId: f.id },
            );
            assert.equal(result.privacyHeld, 0);
            assert.equal(result.failed, 0);
            assert.equal(result.cleaned, 1);
            assert.equal(objects.size, 0);
            if (native) await assert.rejects(() => readPrivateFile(accepted.key, checksum));
          } finally {
            if (native) await deletePrivateFile(accepted.key);
          }
          assert.equal(
            (
              await db
                .select()
                .from(valoExportObjects)
                .where(eq(valoExportObjects.workspaceId, f.owner.workspaceId))
            ).length,
            0,
          );
        },
      );
    } finally {
      for (const path of ownedScratch) await rm(path, { recursive: true, force: true });
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (owners.length) {
        // Removing fixture tombstones first is required by the inventory guard.
        for (const table of [
          valoPrivacyTombstones,
          valoPrivacyErasureObjects,
          valoPrivacyEvents,
          valoPrivacyCases,
          valoExportRequests,
          valoFileAssets,
          valoExportObjects,
          valoExportJobs,
          valoWorkspaceExportAttempts,
          valoWorkspaceExports,
          valoSupportTickets,
          valoEvents,
          valoDocumentRevisions,
          valoDocuments,
          valoProfileVersions,
          valoMemberships,
        ])
          await db.delete(table).where(inArray(table.workspaceId, owners));
        await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, owners));
      }
      if (operators.length) {
        await db.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId, operators));
        await db.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId, operators));
      }
      await closePrivacyErasureLocks();
      await pool.end();
    }
  },
);
