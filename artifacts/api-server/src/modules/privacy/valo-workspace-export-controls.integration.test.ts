import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  valoWorkspaceExports as jobs,
  valoWorkspaceExportAttempts as attempts,
} from "@workspace/db";
import { resolveWorkspace, ValoProblem } from "../../lib/valo-store";
import {
  createWorkspaceExport,
  prepareWorkspaceExport,
  withPreparedWorkspaceExport,
  cancelWorkspaceExport,
  cleanupWorkspaceExports,
  retryWorkspaceExport,
  retireWorkspaceExports,
  workspaceExportScratch,
} from "./valo-workspace-export-jobs";
import type { WorkspaceExportStorage } from "./valo-workspace-export-storage";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
};
test(
  "controlled workspace artifact failures and privacy fences",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 30000,
  },
  async (t) => {
    const actor = await resolveWorkspace("synthetic-workspace-export-controls-" + randomUUID());
    const objects = new Map<string, Buffer>(),
      uploaded = deferred(),
      release = deferred();
    let delay = true,
      failDelete = false;
    const storage: WorkspaceExportStorage = {
      put: async (key, path) => {
        const bytes = await readFile(path);
        if (delay) {
          uploaded.resolve();
          await release.promise;
        }
        objects.set(key, bytes);
      },
      get: async (key, path) => {
        assert.ok(objects.has(key));
        await writeFile(path, objects.get(key)!, { flag: "wx", mode: 0o600 });
      },
      remove: async (key) => {
        if (failDelete) throw Error("CONTROLLED_STORAGE_OUTAGE");
        objects.delete(key);
      },
    };
    const row = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
    try {
      await t.test(
        "late successful upload cannot replace a resumed result; failed deletes remain retryable",
        async () => {
          const job = await createWorkspaceExport(actor, randomUUID()),
            abort = new AbortController();
          const pending = prepareWorkspaceExport(actor, job.id, abort.signal, async () => {}, storage);
          void pending.catch(() => {});
          await uploaded.promise;
          const oldId = (await row(job.id)).currentAttemptId!;
          failDelete = true;
          abort.abort();
          await pending;
          assert.equal((await row(job.id)).status, "interrupted");
          await assert.rejects(stat(workspaceExportScratch(oldId)), { code: "ENOENT" });
          assert.equal((await cleanupWorkspaceExports(storage, actor.workspaceId)).failed, 1);
          const oldAttempt = (await db.select().from(attempts).where(eq(attempts.id, oldId)))[0]!;
          assert.equal(oldAttempt.cleanupErrorCode, "STORAGE_DELETE_FAILED");
          assert.ok(oldAttempt.nextCleanupAt.getTime() > Date.now());
          delay = false;
          await retryWorkspaceExport(actor, job.id, (await row(job.id)).version);
          await prepareWorkspaceExport(actor, job.id, new AbortController().signal, async () => {}, storage);
          const ready = await row(job.id);
          assert.equal(ready.status, "ready");
          assert.notEqual(ready.currentAttemptId, oldId);
          const releasedAt = Date.now();
          release.resolve();
          // Observe the durable late-upload reservation, not a 20 ms timing guess.
          // Cleanup uses SKIP LOCKED; racing that update can legitimately skip this row.
          const deadline = Date.now() + 5000;
          while (true) {
            const late = (await db.select().from(attempts).where(eq(attempts.id, oldId)))[0]!;
            if (
              objects.has(oldAttempt.objectKey) &&
              late.nextCleanupAt.getTime() >= releasedAt &&
              late.cleanupErrorCode === null
            )
              break;
            assert.ok(Date.now() < deadline, "late upload cleanup reservation was not committed");
            await new Promise((r) => setTimeout(r, 10));
          }
          failDelete = false;
          await cleanupWorkspaceExports(storage, actor.workspaceId);
          assert.ok(!objects.has(oldAttempt.objectKey));
          assert.equal((await row(job.id)).status, "ready");
          assert.equal((await row(job.id)).attempts, 2);
          let released = false;
          await withPreparedWorkspaceExport(
            actor,
            job.id,
            new AbortController().signal,
            async () => {},
            async (path) => {
              assert.equal(JSON.parse(await readFile(path, "utf8")).complete, true);
              released = true;
            },
            storage,
          );
          assert.equal(released, true);
          const key = (await db.select().from(attempts).where(eq(attempts.id, ready.currentAttemptId!)))[0]!
            .objectKey;
          objects.set(key, Buffer.from('{"partial":true}'));
          released = false;
          await assert.rejects(
            withPreparedWorkspaceExport(
              actor,
              job.id,
              new AbortController().signal,
              async () => {},
              async () => {
                released = true;
              },
              storage,
            ),
            (error) => error instanceof ValoProblem && error.status === 409,
          );
          assert.equal(released, false);
          await cancelWorkspaceExport(actor, job.id);
        },
      );
      await t.test(
        "privacy fence cancels preparation before release and retains every reserved object key",
        async () => {
          const job = await createWorkspaceExport(actor, randomUUID()),
            seen = deferred(),
            proceed = deferred();
          const pending = prepareWorkspaceExport(
            actor,
            job.id,
            new AbortController().signal,
            async () => {},
            storage,
            async () => {
              seen.resolve();
              await proceed.promise;
            },
          );
          void pending.catch(() => {});
          await seen.promise;
          await db.transaction((tx) => retireWorkspaceExports(tx, actor.workspaceId));
          proceed.resolve();
          await pending;
          assert.equal((await row(job.id)).status, "cancelled");
          const inventory = await db.select().from(attempts).where(eq(attempts.jobId, job.id));
          assert.equal(inventory.length, 1);
          assert.equal(inventory[0]!.status, "cleanup");
          assert.ok(!objects.has(inventory[0]!.objectKey));
        },
      );
      console.log(
        JSON.stringify({
          controlledTransport: true,
          realProviderCalls: 0,
          unknownUploadOutcome: true,
          lateCompletionFenced: true,
          deleteFailureResumable: true,
          tamperRejected: true,
          privacyReservationRetained: true,
        }),
      );
    } finally {
      release.resolve();
      await db.delete(attempts).where(eq(attempts.workspaceId, actor.workspaceId));
      await db.delete(jobs).where(eq(jobs.workspaceId, actor.workspaceId));
      await pool.end();
    }
  },
);
