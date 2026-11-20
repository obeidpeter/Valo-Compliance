import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  valoWorkspaceExports as jobs,
  valoWorkspaceExportAttempts as attempts,
  valoPrivacyCases,
  valoPrivacyEvents,
  valoStaffAssignments,
  valoStaffAccessAudit,
} from "@workspace/db";
import { resolveWorkspace } from "../../lib/valo-store";
import { cleanupWorkspaceExports } from "./valo-workspace-export-jobs";
import { createPrivacyCase, confirmPrivacyCase, simpleStaffPrivacyAction } from "./valo-privacy";
import { readinessQueries } from "../operations/valo-operations";
import type { WorkspaceExportStorage } from "./valo-workspace-export-storage";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
};
const reason = "Synthetic cleanup fairness and privacy hold regression; no real customer data.";

test(
  "workspace cleanup makes bounded progress without widening deletion authority",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 45000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const workspaces: string[] = [],
      cases: string[] = [],
      operators: string[] = [],
      deleted: string[] = [];
    const owner = async () => {
      const a = await resolveWorkspace("synthetic-cleanup-" + randomUUID());
      workspaces.push(a.workspaceId);
      return a;
    };
    type Actor = Awaited<ReturnType<typeof owner>>;
    const storage: WorkspaceExportStorage = {
      put: async () => {
        throw Error("UNEXPECTED_WRITE");
      },
      get: async () => {
        throw Error("UNEXPECTED_READ");
      },
      remove: async (key) => {
        deleted.push(key);
      },
    };
    const seed = async (actor: Actor, count = 1, invalid = false, start = 0) => {
      const jobId = randomUUID();
      await db.insert(jobs).values({
        id: jobId,
        workspaceId: actor.workspaceId,
        requesterId: actor.identityId,
        requestKey: randomUUID(),
        status: "expired",
        expiresAt: new Date(0),
      });
      const rows = Array.from({ length: count }, (_, i) => {
        const id = randomUUID();
        return {
          id,
          workspaceId: actor.workspaceId,
          jobId,
          status: "cleanup" as const,
          objectKey: `valo/development/${actor.workspaceId}/${invalid ? randomUUID() : id}.json`,
          nextCleanupAt: new Date(start + i),
        };
      });
      await db.insert(attempts).values(rows);
      return rows;
    };
    const read = async (id: string) => (await db.select().from(attempts).where(eq(attempts.id, id)))[0]!;
    const due = async (id: string) =>
      db
        .update(attempts)
        .set({ nextCleanupAt: new Date(0) })
        .where(eq(attempts.id, id));
    const hold = async (actor: Actor) => {
      const staff = {
        identityId: "synthetic-cleanup-privacy-" + randomUUID(),
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
      const created = await createPrivacyCase(actor, "synthetic@example.invalid", {
        kind: "deletion",
        idempotencyKey: randomUUID(),
        message: reason,
        acknowledgement: true,
      });
      const id = created.reference.slice(5);
      cases.push(id);
      let detail = await confirmPrivacyCase(actor, id, { expectedVersion: 1, acknowledgement: true });
      detail = await simpleStaffPrivacyAction(staff, id, {
        action: "claim",
        expectedVersion: detail.request.version,
        reason,
      });
      await simpleStaffPrivacyAction(staff, id, {
        action: "hold",
        expectedVersion: detail.request.version,
        reason,
      });
      return id;
    };
    try {
      await t.test("seven invalid reservations cannot starve six valid expired objects", async () => {
        const a = await owner(),
          bad = await seed(a, 7, true),
          good = await seed(a, 6, false, 100),
          before = deleted.length;
        const first = await cleanupWorkspaceExports(storage, a.workspaceId);
        assert.equal(first.checked, 5);
        assert.equal(first.failed, 5);
        assert.equal(first.cleaned, 0);
        const second = await cleanupWorkspaceExports(storage, a.workspaceId);
        assert.equal(second.checked, 5);
        assert.equal(second.failed, 2);
        assert.equal(second.cleaned, 3);
        const third = await cleanupWorkspaceExports(storage, a.workspaceId);
        assert.equal(third.checked, 3);
        assert.equal(third.cleaned, 3);
        assert.deepEqual(deleted.slice(before).sort(), good.map((x) => x.objectKey).sort());
        for (const row of bad) {
          const saved = await read(row.id);
          assert.equal(saved.objectKey, row.objectKey);
          assert.equal(saved.cleanupCheckedAt, null);
          assert.equal(saved.cleanupErrorCode, "INVALID_PRIVATE_KEY");
          assert.equal(saved.cleanupAttempts, 1);
          assert.ok(saved.nextCleanupAt.getTime() > Date.now() + 3_500_000);
        }
        assert.equal((await cleanupWorkspaceExports(storage, a.workspaceId)).checked, 0);
      });
      await t.test(
        "storage outage backs off without a success timestamp, then retries and rechecks late uploads",
        async () => {
          const a = await owner(),
            [row] = await seed(a),
            objects = new Set([row!.objectKey]);
          let calls = 0,
            fail = true;
          const s = {
            ...storage,
            remove: async (key: string) => {
              calls++;
              if (fail) throw Error("PRIVATE_PROVIDER_ERROR_MUST_NOT_BE_STORED");
              objects.delete(key);
            },
          };
          assert.equal((await cleanupWorkspaceExports(s, a.workspaceId)).failed, 1);
          let saved = await read(row!.id);
          assert.equal(saved.cleanupCheckedAt, null);
          assert.equal(saved.cleanupErrorCode, "STORAGE_DELETE_FAILED");
          assert.ok(saved.nextCleanupAt.getTime() > Date.now() + 25_000);
          assert.ok(saved.nextCleanupAt.getTime() < Date.now() + 35_000);
          assert.equal((await cleanupWorkspaceExports(s, a.workspaceId)).checked, 0);
          assert.equal(calls, 1);
          await due(row!.id);
          await cleanupWorkspaceExports(s, a.workspaceId);
          saved = await read(row!.id);
          assert.equal(saved.cleanupAttempts, 2);
          assert.ok(saved.nextCleanupAt.getTime() > Date.now() + 55_000);
          fail = false;
          await due(row!.id);
          assert.equal((await cleanupWorkspaceExports(s, a.workspaceId)).cleaned, 1);
          saved = await read(row!.id);
          assert.ok(saved.cleanupCheckedAt);
          assert.equal(saved.cleanupErrorCode, null);
          assert.equal(objects.size, 0);
          objects.add(row!.objectKey);
          await due(row!.id);
          await cleanupWorkspaceExports(s, a.workspaceId);
          assert.equal(objects.size, 0);
          assert.equal((await read(row!.id)).cleanupAttempts, 4);
        },
      );
      await t.test(
        "authenticated privacy holds yield the next batch without deleting held objects",
        async () => {
          const a = await owner(),
            b = await owner();
          await hold(a);
          const held = await seed(a, 5),
            good = await seed(b, 2, false, 1000),
            before = deleted.length;
          const first = await cleanupWorkspaceExports(storage);
          assert.equal(first.held, 5);
          assert.equal(first.cleaned, 0);
          const second = await cleanupWorkspaceExports(storage);
          assert.equal(second.cleaned, 2);
          assert.deepEqual(deleted.slice(before).sort(), good.map((x) => x.objectKey).sort());
          for (const row of held) {
            const saved = await read(row.id);
            assert.equal(saved.cleanupErrorCode, "PRIVACY_HOLD");
            assert.equal(saved.cleanupCheckedAt, null);
          }
        },
      );
      await t.test(
        "concurrent cleanup sees a committed retry reservation before storage finishes",
        async () => {
          const a = await owner(),
            [row] = await seed(a),
            entered = deferred(),
            release = deferred();
          let calls = 0;
          const s = {
            ...storage,
            remove: async () => {
              calls++;
              entered.resolve();
              await release.promise;
            },
          };
          const active = cleanupWorkspaceExports(s, a.workspaceId);
          try {
            await entered.promise;
            const observed = await read(row!.id);
            assert.equal(observed.cleanupAttempts, 1);
            assert.ok(observed.nextCleanupAt.getTime() > Date.now());
            const concurrent = await cleanupWorkspaceExports(s, a.workspaceId);
            assert.equal(concurrent.checked, 0);
            assert.equal(calls, 1);
          } finally {
            release.resolve();
          }
          assert.equal((await active).cleaned, 1);
        },
      );
      await t.test(
        "case lock timeout leaves a durable retry and does not block another workspace",
        async () => {
          const a = await owner(),
            b = await owner(),
            caseId = await hold(a),
            [row] = await seed(a),
            good = await seed(b, 1, false, 2000),
            blocker = await pool.connect(),
            before = deleted.length;
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM valo_privacy_cases WHERE id=$1 FOR UPDATE", [caseId]);
            await assert.rejects(cleanupWorkspaceExports(storage, a.workspaceId), (error) => {
              const e = error as { code?: string; cause?: { code?: string } };
              return e.code === "55P03" || e.cause?.code === "55P03";
            });
            const saved = await read(row!.id);
            assert.ok(saved.nextCleanupAt.getTime() > Date.now());
            assert.equal(saved.cleanupCheckedAt, null);
            assert.equal(saved.cleanupAttempts, 1);
            assert.equal((await cleanupWorkspaceExports(storage, b.workspaceId)).cleaned, 1);
            assert.deepEqual(
              deleted.slice(before),
              good.map((x) => x.objectKey),
            );
          } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
          }
        },
      );
      await t.test("backoff does not hide blocked cleanup from operational probes", async () => {
        const result = await pool.query(readinessQueries.workspaceCleanup);
        assert.ok(result.rows[0].value >= 12);
        const report = JSON.stringify(result.rows);
        assert.ok(!report.includes("object_key"));
        assert.ok(!report.includes("PRIVATE_PROVIDER_ERROR"));
      });
    } finally {
      // Only rows created by this synthetic invocation; no native storage used.
      if (cases.length) {
        await db.delete(valoPrivacyEvents).where(inArray(valoPrivacyEvents.caseId, cases));
        await db.delete(valoPrivacyCases).where(inArray(valoPrivacyCases.id, cases));
      }
      if (operators.length) {
        await db.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId, operators));
        await db.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId, operators));
      }
      if (workspaces.length) {
        await db.delete(attempts).where(inArray(attempts.workspaceId, workspaces));
        await db.delete(jobs).where(inArray(jobs.workspaceId, workspaces));
      }
      await pool.end();
    }
  },
);
