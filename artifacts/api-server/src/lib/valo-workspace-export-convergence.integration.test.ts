import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import express from "express";
import {
  db,
  pool,
  valoWorkspaceExports as jobs,
  valoWorkspaceExportAttempts as attempts,
  valoFileAssets,
  valoExportObjects,
  valoEvents,
  valoWorkspaces,
  valoMemberships,
  valoExportJobs,
  valoExportRequests,
  valoDocuments,
  valoDocumentRevisions,
  valoPrivacyCases,
  valoPrivacyEvents,
  valoPrivacyTombstones,
  valoPrivacyErasureObjects,
  valoStaffAssignments,
  valoStaffAccessAudit,
  valoSupportTickets,
} from "@workspace/db";
import { resolveWorkspace, createDocument, ValoProblem } from "./valo-store";
import {
  createWorkspaceExport,
  getWorkspaceExport,
  listWorkspaceExports,
  cancelWorkspaceExport,
  retryWorkspaceExport,
  executeWorkspaceExport,
  recoverWorkspaceExports,
  cleanupWorkspaceExports,
  withPreparedWorkspaceExport,
  workspaceExportScratch,
  pendingWorkspaceExports,
  WORKSPACE_EXPORT_QUEUE,
} from "./valo-workspace-export-jobs";
import { fixtureWorkspaceStorage } from "./test-support/workspace-export-storage";
import { exportQueue } from "./valo-export-queue";
import { makeWorkspaceExportRouter } from "./valo-workspace-export-http";
import { syntheticDocument } from "./valo-test-fixtures";
import { requestExport } from "./valo-exports";
import { reconcileExportOrphans } from "./valo-export-recovery";
import { createPrivacyCase, confirmPrivacyCase, simpleStaffPrivacyAction } from "./valo-privacy";
import { processPrivacyErasure, closePrivacyErasureLocks } from "./valo-privacy-erasure";
const reason = "Controlled synthetic canonical export lifecycle proof; no customer/provider data.";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const bounded = <T>(promise: Promise<T>, ms = 8000) =>
  Promise.race([
    promise,
    new Promise<never>((_r, j) => {
      const t = setTimeout(() => j(Error("CONTROLLED_WAIT_TIMEOUT")), ms);
      t.unref();
    }),
  ]);
test(
  "canonical native export jobs: actual PostgreSQL, worker leases, private fixture files and HTTP release",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 180000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const directory = await mkdtemp(join(tmpdir(), "valo-canonical-export-")),
      storage = fixtureWorkspaceStorage(directory);
    const owners: string[] = [],
      operators: string[] = [],
      children: ChildProcess[] = [];
    const owner = async () => {
      const a = await resolveWorkspace("synthetic-workspace-export-" + randomUUID());
      owners.push(a.workspaceId);
      return a;
    };
    type Actor = Awaited<ReturnType<typeof owner>>;
    const raw = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
    const attempt = async (id: string) =>
      (await db.select().from(attempts).where(eq(attempts.jobId, id)))[0]!;
    const run = async (a: Actor, id: string, options: Parameters<typeof executeWorkspaceExport>[3] = {}) =>
      executeWorkspaceExport(id, a.workspaceId, (await raw(id)).queueId, { storage, ...options });
    const prepare = async (a: Actor) => {
      const j = await createWorkspaceExport(a, randomUUID());
      await run(a, j.id);
      assert.equal((await raw(j.id)).status, "ready");
      return raw(j.id);
    };
    const release = (
      a: Actor,
      id: string,
      consume: (path: string) => Promise<unknown>,
      verify = async () => {},
      s = storage,
    ) => withPreparedWorkspaceExport(a, id, new AbortController().signal, verify, consume, s);
    const a = await owner(),
      b = await owner();
    try {
      await t.test(
        "stable native IDs, request-key idempotency, safe DTO and tenant-bound newest history",
        async () => {
          const key = randomUUID(),
            [x, y] = await Promise.all([createWorkspaceExport(a, key), createWorkspaceExport(a, key)]);
          assert.equal(x.id, y.id);
          assert.equal(
            (await createWorkspaceExport(a, randomUUID())).id,
            x.id,
            "one active native request reused",
          );
          await assert.rejects(getWorkspaceExport(b, x.id), { status: 404 });
          for (const secret of ["queueId", "objectKey", "leaseUntil", "requesterId"])
            assert.ok(!JSON.stringify(x).includes(secret));
          await cancelWorkspaceExport(a, x.id, x.version);
          assert.equal((await createWorkspaceExport(a, key)).status, "cancelled");
          await db
            .update(jobs)
            .set({ expiresAt: new Date(0) })
            .where(eq(jobs.id, x.id));
          assert.equal(
            (await getWorkspaceExport(a, x.id)).status,
            "cancelled",
            "history preserves cancellation after its former expiry",
          );
          const actor = await owner();
          await db.insert(jobs).values(
            Array.from({ length: 30 }, (_, i) => ({
              id: randomUUID(),
              workspaceId: actor.workspaceId,
              requesterId: actor.identityId,
              requestKey: randomUUID(),
              status: "cancelled" as const,
              expiresAt: new Date(Date.now() + 86400000),
              createdAt: new Date(Date.now() - 172800000 - i * 1000),
            })),
          );
          const newest = await createWorkspaceExport(actor, randomUUID()),
            first = await listWorkspaceExports(actor),
            second = await listWorkspaceExports(actor, first.nextCursor!);
          assert.equal(first.items[0]!.id, newest.id);
          assert.equal(first.items.length, 25);
          assert.equal(second.items.length, 6);
          assert.equal(new Set([...first.items, ...second.items].map((j) => j.id)).size, 31);
          await assert.rejects(listWorkspaceExports(b, newest.id), { status: 409 });
        },
      );
      await t.test(
        "actual pg-boss dispatch consumes one persisted native request without a download request",
        async () => {
          const actor = await owner(),
            j = await createWorkspaceExport(actor, randomUUID()),
            row = await raw(j.id);
          const installed = await pool.query("select to_regclass('valo_jobs.version') as installed");
          if (!installed.rows[0].installed)
            await pool.query(
              await readFile(
                new URL("../../../../lib/db/drizzle/pg-boss-development.sql", import.meta.url),
                "utf8",
              ),
            );
          const boss = exportQueue(),
            errors: unknown[] = [];
          boss.on("error", (error) => errors.push(error));
          await boss.start();
          try {
            await boss.createQueue(WORKSPACE_EXPORT_QUEUE, { retryLimit: 0, expireInSeconds: 360 });
            const done = deferred();
            let executions = 0;
            await boss.work<{ jobId: string; workspaceId: string }>(
              WORKSPACE_EXPORT_QUEUE,
              { batchSize: 1, pollingIntervalSeconds: 1 },
              async (entries) => {
                for (const entry of entries) {
                  assert.equal(entry.data.jobId, j.id);
                  assert.equal(entry.data.workspaceId, actor.workspaceId);
                  executions++;
                  await executeWorkspaceExport(entry.data.jobId, entry.data.workspaceId, entry.id, {
                    storage,
                  });
                  done.resolve();
                }
              },
            );
            assert.ok(
              (await pendingWorkspaceExports()).some((x) => x.id === j.id && x.queueId === row.queueId),
            );
            await boss.send(
              WORKSPACE_EXPORT_QUEUE,
              { jobId: j.id, workspaceId: actor.workspaceId },
              { id: row.queueId },
            );
            await boss.send(
              WORKSPACE_EXPORT_QUEUE,
              { jobId: j.id, workspaceId: actor.workspaceId },
              { id: row.queueId },
            );
            await bounded(done.promise, 15000);
            assert.equal(executions, 1);
            assert.equal((await raw(j.id)).status, "ready");
            assert.equal((await raw(j.id)).attempts, 1);
            assert.deepEqual(errors, []);
          } finally {
            await boss.stop({ graceful: true, timeout: 60000 });
          }
        },
      );
      await t.test(
        "background preparation above 8 MB and 5000 rows releases complete tenant-scoped snapshot after reload",
        async () => {
          const expectedEvents = Array.from({ length: 6001 }, (_, i) => ({
            id: randomUUID(),
            workspaceId: a.workspaceId,
            actorId: a.identityId,
            entityId: a.workspaceId,
            action: `row-${i}-${"x".repeat(1400)}`,
          }));
          await db.insert(valoEvents).values(expectedEvents);
          await db.insert(valoEvents).values({
            id: randomUUID(),
            workspaceId: b.workspaceId,
            actorId: b.identityId,
            entityId: b.workspaceId,
            action: "OTHER_TENANT_PRIVATE",
          });
          const late = {
            id: randomUUID(),
            workspaceId: a.workspaceId,
            actorId: a.identityId,
            entityId: a.workspaceId,
            action: "NEW_SNAPSHOT_ONLY",
          };
          const requested = await createWorkspaceExport(a, randomUUID());
          let inserted = false;
          await run(a, requested.id, {
            onPage: async (section, count) => {
              if (section === "yourActivity" && count === 500 && !inserted) {
                inserted = true;
                await db.insert(valoEvents).values(late);
              }
            },
          });
          const row = await raw(requested.id);
          assert.equal(row.status, "ready");
          assert.ok(row.bytesPrepared > 8000000);
          assert.ok(row.rowsProcessed >= 6001);
          const body = (await release(a, row.id, async (path) =>
            JSON.parse(await readFile(path, "utf8")),
          )) as { complete: boolean; data: { yourActivity: { id: string }[] } };
          assert.equal(body.complete, true);
          assert.equal(body.data.yourActivity.length, 6001);
          assert.deepEqual(
            body.data.yourActivity.map((r) => r.id).sort(),
            expectedEvents.map((r) => r.id).sort(),
            "fixed snapshot excludes exactly identified concurrent insertion",
          );
          assert.ok(!JSON.stringify(body).includes("OTHER_TENANT_PRIVATE"));
          assert.equal((await getWorkspaceExport(a, row.id)).status, "ready");
          const next = await prepare(a),
            nextBody = (await release(a, next.id, async (path) =>
              JSON.parse(await readFile(path, "utf8")),
            )) as { data: { yourActivity: { id: string }[] } };
          assert.deepEqual(
            nextBody.data.yourActivity.map((r) => r.id).sort(),
            [...expectedEvents.map((r) => r.id), late.id].sort(),
            "new dated whole snapshot includes the later row once",
          );
        },
      );
      await t.test(
        "current session, membership, cancellation and abort after private retrieval release zero bytes",
        async () => {
          for (const mode of ["session", "membership", "cancel", "abort"]) {
            const row = await prepare(a),
              controller = new AbortController();
            let released = 0,
              checks = 0;
            await assert.rejects(
              withPreparedWorkspaceExport(
                a,
                row.id,
                controller.signal,
                async () => {
                  if (++checks !== 2) return;
                  if (mode === "session") throw Error("CONTROLLED_SESSION_REVOKED");
                  if (mode === "membership")
                    await db
                      .update(valoMemberships)
                      .set({ active: "no" })
                      .where(eq(valoMemberships.workspaceId, a.workspaceId));
                  if (mode === "cancel") await cancelWorkspaceExport(a, row.id, row.version);
                  if (mode === "abort") controller.abort();
                },
                async () => {
                  released++;
                },
                storage,
              ),
            );
            assert.equal(released, 0);
            assert.equal(checks, 2);
            await db
              .update(valoMemberships)
              .set({ active: "yes" })
              .where(eq(valoMemberships.workspaceId, a.workspaceId));
          }
        },
      );
      await t.test(
        "a blocked cancel times out without changing the ready job or its private attempt",
        async () => {
          const actor = await owner(),
            row = await prepare(actor),
            blocker = await pool.connect();
          try {
            await blocker.query("begin");
            await blocker.query("select id from valo_workspace_exports where id=$1 for update", [row.id]);
            await assert.rejects(bounded(cancelWorkspaceExport(actor, row.id, row.version)), (error) => {
              const failure = error as { code?: string; cause?: { code?: string } };
              return failure.code === "55P03" || failure.cause?.code === "55P03";
            });
            assert.equal((await raw(row.id)).status, "ready");
            assert.equal((await raw(row.id)).version, row.version);
            assert.equal((await attempt(row.id)).status, "ready");
          } finally {
            await blocker.query("rollback");
            blocker.release();
          }
        },
      );
      await t.test(
        "managed session revocation while final job lock is held wins before headers",
        async () => {
          const actor = await owner(),
            row = await prepare(actor),
            blocker = await pool.connect(),
            rechecked = deferred();
          let checks = 0,
            revoked = false,
            released = 0;
          try {
            await blocker.query("begin");
            await blocker.query("select id from valo_workspace_exports where id=$1 for update", [row.id]);
            const waiting = release(
              actor,
              row.id,
              async () => {
                released++;
              },
              async () => {
                checks++;
                if (checks === 2) rechecked.resolve();
                if (revoked) throw Error("CONTROLLED_SESSION_REVOKED_AFTER_LOCK_WAIT");
              },
            );
            await bounded(rechecked.promise);
            await new Promise((r) => setTimeout(r, 25));
            revoked = true;
            await blocker.query("commit");
            await assert.rejects(waiting, /CONTROLLED_SESSION_REVOKED_AFTER_LOCK_WAIT/);
            assert.equal(checks, 3);
            assert.equal(released, 0);
          } finally {
            await blocker.query("rollback");
            blocker.release();
          }
        },
      );
      await t.test("exact attempt/workspace key binding and checksum corruption deny release", async () => {
        const actor = await owner(),
          row = await prepare(actor),
          obj = await attempt(row.id);
        let reads = 0;
        await db
          .update(attempts)
          .set({ objectKey: `valo/development/${b.workspaceId}/${obj.id}.json` })
          .where(eq(attempts.id, obj.id));
        await assert.rejects(
          release(
            actor,
            row.id,
            async () => assert.fail("bytes"),
            async () => {},
            {
              ...storage,
              get: async () => {
                reads++;
              },
            },
          ),
          { status: 409 },
        );
        assert.equal(reads, 0);
        await db.update(attempts).set({ objectKey: obj.objectKey }).where(eq(attempts.id, obj.id));
        await writeFile(join(directory, basename(obj.objectKey)), "corrupted");
        await assert.rejects(
          release(actor, row.id, async () => assert.fail("corrupted bytes")),
          { status: 409 },
        );
      });
      await t.test(
        "accepted upload, cancel and later completion cannot publish; cleanup tracks repeated late writes",
        async () => {
          const actor = await owner(),
            j = await createWorkspaceExport(actor, randomUUID()),
            seen = deferred(),
            go = deferred();
          const work = run(actor, j.id, {
            onStage: async (stage) => {
              if (stage === "uploaded") {
                seen.resolve();
                await go.promise;
              }
            },
          });
          await bounded(seen.promise);
          await cancelWorkspaceExport(actor, j.id, (await raw(j.id)).version);
          go.resolve();
          await bounded(work);
          assert.equal((await raw(j.id)).status, "cancelled");
          const obj = await attempt(j.id);
          assert.equal(obj.status, "cleanup");
          await cleanupWorkspaceExports(storage, actor.workspaceId);
          await assert.rejects(readFile(join(directory, basename(obj.objectKey))));
          await writeFile(join(directory, basename(obj.objectKey)), "late accepted upload");
          await db
            .update(attempts)
            .set({ nextCleanupAt: new Date(0) })
            .where(eq(attempts.id, obj.id));
          await cleanupWorkspaceExports(storage, actor.workspaceId);
          await assert.rejects(readFile(join(directory, basename(obj.objectKey))));
        },
      );
      await t.test(
        "progress heartbeat never traps snapshot behind job lock and membership revocation",
        async () => {
          const actor = await owner(),
            j = await createWorkspaceExport(actor, randomUUID()),
            seen = deferred(),
            go = deferred();
          let paused = false;
          const work = run(actor, j.id, {
            onPage: async () => {
              if (!paused) {
                paused = true;
                seen.resolve();
                await go.promise;
              }
            },
          });
          await bounded(seen.promise);
          const blocker = await pool.connect();
          try {
            await blocker.query("begin");
            await blocker.query("select id from valo_workspace_exports where id=$1 for update", [j.id]);
            await bounded(
              db
                .update(valoMemberships)
                .set({ active: "no" })
                .where(eq(valoMemberships.workspaceId, actor.workspaceId))
                .then(() => {}),
              1000,
            );
            const cancel = cancelWorkspaceExport(actor, j.id).catch((error) => error);
            go.resolve();
            // Heartbeat SKIP LOCKED aborts the snapshot before its catch waits on job.
            await new Promise((r) => setTimeout(r, 100));
            await blocker.query("commit");
            await bounded(work);
            assert.equal((await cancel).status, 403);
            assert.equal((await raw(j.id)).status, "interrupted");
          } finally {
            go.resolve();
            await blocker.query("rollback");
            blocker.release();
          }
        },
      );
      for (const stage of ["claimed", "uploaded", "completing"] as const)
        await t.test(
          `actual SIGKILL at ${stage} recovers one native job with a fresh reserved attempt`,
          async () => {
            const actor = await owner(),
              j = await createWorkspaceExport(actor, randomUUID()),
              row = await raw(j.id);
            const child = fork(
              fileURLToPath(new URL("../scripts/workspace-export-crash-child.ts", import.meta.url)),
              [row.id, actor.workspaceId, row.queueId, stage, directory],
              { execArgv: ["--import", "tsx"], env: process.env, stdio: ["ignore", "ignore", "pipe", "ipc"] },
            );
            children.push(child);
            const event = await bounded(
              Promise.race([
                once(child, "message"),
                once(child, "exit").then(() => {
                  throw Error("CHILD_EXITED_EARLY");
                }),
              ]),
              15000,
            );
            assert.equal(event[0].stage, stage);
            const exit = once(child, "exit");
            child.kill("SIGKILL");
            await exit;
            await db
              .update(jobs)
              .set({ leaseUntil: new Date(0) })
              .where(eq(jobs.id, j.id));
            await recoverWorkspaceExports(actor.workspaceId);
            const recovered = await raw(j.id);
            assert.equal(recovered.id, row.id);
            assert.notEqual(recovered.queueId, row.queueId);
            await run(actor, j.id);
            assert.equal((await raw(j.id)).status, "ready");
            assert.equal((await raw(j.id)).attempts, 2);
            const generations = await db.select().from(attempts).where(eq(attempts.jobId, j.id));
            assert.equal(generations.length, 2);
            assert.notEqual(generations[0]!.objectKey, generations[1]!.objectKey);
          },
        );
      await t.test(
        "explicit retry is versioned and bounded; expired native artifacts release nothing",
        async () => {
          const actor = await owner(),
            j = await createWorkspaceExport(actor, randomUUID());
          for (let i = 0; i < 5; i++) {
            await run(actor, j.id, {
              storage: {
                ...storage,
                put: async () => {
                  throw Error("CONTROLLED_OUTAGE");
                },
              },
            });
            const row = await raw(j.id);
            assert.equal(row.status, "interrupted");
            if (i < 4) {
              await assert.rejects(retryWorkspaceExport(actor, j.id, row.version - 1), { status: 409 });
              await retryWorkspaceExport(actor, j.id, row.version);
            }
          }
          assert.equal((await raw(j.id)).attempts, 5);
          assert.equal((await getWorkspaceExport(actor, j.id)).retryAvailable, false);
          await assert.rejects(retryWorkspaceExport(actor, j.id, (await raw(j.id)).version), { status: 409 });
          await cancelWorkspaceExport(actor, j.id);
          const ready = await prepare(actor);
          await db
            .update(jobs)
            .set({ expiresAt: new Date(0) })
            .where(eq(jobs.id, ready.id));
          await assert.rejects(
            release(actor, ready.id, async () => assert.fail("expired bytes")),
            { status: 409 },
          );
          await cleanupWorkspaceExports(storage, actor.workspaceId);
          assert.equal((await raw(ready.id)).status, "expired");
        },
      );
      await t.test(
        "native HTTP GET only releases ready results and preserves authorized byte ranges",
        async () => {
          const actor = await owner();
          let checks = 0;
          const app = express();
          app.use(express.json());
          app.use((_req, res, next) => {
            res.locals.valoActor = actor;
            next();
          });
          app.use(
            makeWorkspaceExportRouter(async () => {
              checks++;
            }, storage),
          );
          app.use((e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) =>
            res.status(e instanceof ValoProblem ? e.status : 503).json({ error: "Controlled rejection" }),
          );
          const server = app.listen(0, "127.0.0.1");
          await once(server, "listening");
          const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
          try {
            const j = await createWorkspaceExport(actor, randomUUID());
            const queued = await fetch(`${base}/workspace/data-exports/${j.id}/download`);
            assert.equal(queued.status, 409);
            assert.equal(queued.headers.get("Content-Disposition"), null);
            assert.equal((await raw(j.id)).attempts, 0);
            await run(actor, j.id);
            const whole = await fetch(`${base}/workspace/data-exports/${j.id}/download`),
              text = await whole.text();
            assert.equal(whole.status, 200);
            const range = await fetch(`${base}/workspace/data-exports/${j.id}/download`, {
              headers: { Range: "bytes=0-99", "If-Range": whole.headers.get("ETag")! },
            });
            assert.equal(range.status, 206);
            assert.equal(await range.text(), text.slice(0, 100));
            assert.ok(checks >= 5);
            await cancelWorkspaceExport(actor, j.id);
            const denied = await fetch(`${base}/workspace/data-exports/${j.id}/download`);
            assert.equal(denied.status, 409);
            assert.equal(denied.headers.get("Content-Disposition"), null);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((r) => server.close(() => r()));
          }
        },
      );
      await t.test(
        "mixed document/JSON cleanup honors pre-quarantine hold; both pending key families seal and metadata erases in bounded phase",
        async () => {
          const actor = await owner(),
            wj = await prepare(actor),
            json = await attempt(wj.id),
            document = await createDocument(actor, syntheticDocument);
          let downloadPath = "";
          await release(actor, wj.id, async (path) => {
            downloadPath = path;
            assert.match(
              relative(workspaceExportScratch(json.id), path),
              /^download-[^\\/]+[\\/]workspace\.json$/,
            );
            assert.ok((await stat(path)).size > 0);
          });
          await assert.rejects(stat(downloadPath), { code: "ENOENT" });
          // Recreate a process-death leftover at the actual release staging path.
          await mkdir(dirname(downloadPath), { recursive: true });
          await writeFile(downloadPath, "SYNTHETIC_PRIVATE_DOWNLOAD_LEFTOVER");
          const doc = await requestExport(actor, document.id, randomUUID(), {
            revisionId: document.revisionId,
            format: "docx",
            acknowledgeDraft: true,
          });
          const [dj] = await db.select().from(valoExportJobs).where(eq(valoExportJobs.id, doc.id));
          const docKey = `valo/development/${actor.workspaceId}/${randomUUID()}.docx`;
          await db.insert(valoExportObjects).values({
            objectKey: docKey,
            workspaceId: actor.workspaceId,
            jobId: doc.id,
            queueId: dj!.queueId,
            state: "cleanup",
          });
          await db.insert(valoFileAssets).values({
            id: randomUUID(),
            workspaceId: actor.workspaceId,
            jobId: doc.id,
            objectKey: docKey,
            checksum: "a".repeat(64),
            size: 1,
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
          const removed: string[] = [];
          await reconcileExportOrphans(doc.id, async (key) => {
            removed.push(key);
          });
          await cleanupWorkspaceExports(
            {
              ...storage,
              remove: async (key) => {
                removed.push(key);
              },
            },
            actor.workspaceId,
          );
          assert.ok(!removed.includes(docKey));
          assert.ok(!removed.includes(json.objectKey));
          const staff = {
            identityId: "synthetic-export-privacy-" + randomUUID(),
            recentMfa: true,
            verifiedAt: Date.now(),
          };
          operators.push(staff.identityId);
          await db.insert(valoStaffAssignments).values({
            id: randomUUID(),
            identityId: staff.identityId,
            role: "privacy",
            grantedBy: "synthetic",
            reason,
          });
          const c = await createPrivacyCase(actor, "synthetic@example.invalid", {
              kind: "deletion",
              idempotencyKey: randomUUID(),
              message: reason,
              acknowledgement: true,
            }),
            caseId = c.reference.slice(5);
          let detail = await confirmPrivacyCase(actor, caseId, { expectedVersion: 1, acknowledgement: true });
          detail = await simpleStaffPrivacyAction(staff, caseId, {
            action: "claim",
            expectedVersion: detail.request.version,
            reason,
          });
          const orphanDoc = `valo/development/${actor.workspaceId}/${randomUUID()}.pdf`;
          await db.insert(valoExportObjects).values({
            objectKey: orphanDoc,
            workspaceId: actor.workspaceId,
            jobId: doc.id,
            queueId: dj!.queueId,
            state: "cleanup",
          });
          detail = await simpleStaffPrivacyAction(staff, caseId, {
            action: "hold",
            expectedVersion: detail.request.version,
            reason,
          });
          await cancelWorkspaceExport(actor, wj.id, wj.version);
          let deletes = 0;
          const heldStorage = {
            ...storage,
            remove: async () => {
              deletes++;
            },
          };
          await cleanupWorkspaceExports(heldStorage, actor.workspaceId);
          await reconcileExportOrphans(doc.id, heldStorage.remove);
          assert.equal(deletes, 0);
          detail = await simpleStaffPrivacyAction(staff, caseId, {
            action: "release_hold",
            expectedVersion: detail.request.version,
            reason,
          });
          const pending = await createWorkspaceExport(actor, randomUUID()),
            aid = randomUUID(),
            futureJson = `valo/development/${actor.workspaceId}/${aid}.json`,
            futureDoc = `valo/development/${actor.workspaceId}/${randomUUID()}.pdf`;
          await db.insert(attempts).values([
            { id: aid, jobId: pending.id, workspaceId: actor.workspaceId, objectKey: futureJson },
            ...Array.from({ length: 103 }, () => {
              const id = randomUUID();
              return {
                id,
                jobId: pending.id,
                workspaceId: actor.workspaceId,
                objectKey: `valo/development/${actor.workspaceId}/${id}.json`,
              };
            }),
          ]);
          await db.insert(valoExportObjects).values({
            objectKey: futureDoc,
            workspaceId: actor.workspaceId,
            jobId: doc.id,
            queueId: dj!.queueId,
            state: "pending",
          });
          detail = await processPrivacyErasure(
            staff,
            caseId,
            {
              action: "start_erasure",
              expectedVersion: detail.request.version,
              reason,
              acknowledgement: true,
            },
            storage.remove,
          );
          detail = await processPrivacyErasure(
            staff,
            caseId,
            {
              action: "resume_erasure",
              expectedVersion: detail.request.version,
              reason,
              acknowledgement: true,
            },
            storage.remove,
          );
          const captured = await db
            .select()
            .from(valoPrivacyErasureObjects)
            .where(eq(valoPrivacyErasureObjects.caseId, caseId));
          for (const key of [docKey, orphanDoc, json.objectKey, futureJson, futureDoc])
            assert.ok(captured.some((o) => o.objectKey === key));
          await assert.rejects(createWorkspaceExport(actor, randomUUID()), { status: 403 });
          await assert.rejects(
            db.insert(valoPrivacyErasureObjects).values({
              caseId,
              workspaceId: actor.workspaceId,
              objectKey: `valo/development/${actor.workspaceId}/${randomUUID()}.json`,
            }),
          );
          detail = await simpleStaffPrivacyAction(staff, caseId, {
            action: "hold",
            expectedVersion: detail.request.version,
            reason,
          });
          await cleanupWorkspaceExports(heldStorage, actor.workspaceId);
          assert.equal(deletes, 0);
          detail = await simpleStaffPrivacyAction(staff, caseId, {
            action: "release_hold",
            expectedVersion: detail.request.version,
            reason,
          });
          const phase = async () =>
            (await db.select().from(valoPrivacyCases).where(eq(valoPrivacyCases.id, caseId)))[0]!
              .erasurePhase;
          for (let i = 0; i < 80 && (await phase()) !== "application_erased"; i++) {
            const before =
              (await db.select().from(attempts).where(eq(attempts.workspaceId, actor.workspaceId))).length +
              (await db.select().from(jobs).where(eq(jobs.workspaceId, actor.workspaceId))).length;
            detail = await processPrivacyErasure(
              staff,
              caseId,
              {
                action: "resume_erasure",
                expectedVersion: detail.request.version,
                reason,
                acknowledgement: true,
              },
              storage.remove,
            );
            const after =
              (await db.select().from(attempts).where(eq(attempts.workspaceId, actor.workspaceId))).length +
              (await db.select().from(jobs).where(eq(jobs.workspaceId, actor.workspaceId))).length;
            assert.ok(before - after <= 100, "workspace metadata shares the bounded phase budget");
          }
          assert.equal(await phase(), "application_erased");
          assert.equal(
            (await db.select().from(jobs).where(eq(jobs.workspaceId, actor.workspaceId))).length,
            0,
          );
          assert.equal(
            (await db.select().from(attempts).where(eq(attempts.workspaceId, actor.workspaceId))).length,
            0,
          );
          await assert.rejects(stat(downloadPath), { code: "ENOENT" });
          await assert.rejects(release(actor, wj.id, async () => assert.fail("quarantined bytes")));
        },
      );
    } finally {
      for (const child of children) if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role=replica`);
        for (const table of [
          valoPrivacyErasureObjects,
          valoPrivacyEvents,
          valoPrivacyTombstones,
          valoPrivacyCases,
          valoExportRequests,
          valoFileAssets,
          valoExportObjects,
          attempts,
          jobs,
          valoExportJobs,
          valoDocumentRevisions,
          valoDocuments,
          valoSupportTickets,
          valoEvents,
          valoMemberships,
        ])
          await tx.delete(table).where(inArray(table.workspaceId, owners));
        await tx.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, owners));
        await tx.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId, operators));
        await tx.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId, operators));
      });
      await closePrivacyErasureLocks();
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
