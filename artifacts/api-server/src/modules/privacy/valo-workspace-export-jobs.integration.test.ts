/** Native private-storage compatibility run. Requires explicit synthetic native
 * setup; disposable CI uses the separate controlled-transport convergence suite.
 * Retained e29 reports describe the previous synchronous-preparer implementation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import {
  db,
  pool,
  valoEvents,
  valoMemberships,
  valoWorkspaceExports as jobs,
  valoWorkspaceExportAttempts as attempts,
} from "@workspace/db";
import { makeWorkspaceExportRouter } from "../../lib/valo-workspace-export-http";
import { resolveWorkspace } from "../../lib/valo-store";
import { ValoProblem } from "../../platform/valo-problem";
import { assertWorkspaceDownloadSession } from "../../lib/valo-download-session";
import {
  createWorkspaceExport,
  executeWorkspaceExport,
  recoverWorkspaceExports,
  cancelWorkspaceExport,
} from "./valo-workspace-export-jobs";
import { workspaceExportStorage } from "./valo-workspace-export-storage";
import { anonymousPrivateFileStatus } from "../../platform/valo-private-storage";
const bounded = <T>(p: Promise<T>, ms = 15000) =>
  Promise.race([
    p,
    new Promise<never>((_r, j) => {
      const t = setTimeout(() => j(Error("CONTROLLED_WAIT_TIMEOUT")), ms);
      t.unref();
    }),
  ]);
test(
  "canonical background export compatibility with actual native private storage and authorized ranged HTTP",
  {
    skip: process.env.VALO_RUN_NATIVE_WORKSPACE_EXPORTS !== "synthetic-development-only",
    timeout: 120000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(process.env.PRIVATE_OBJECT_DIR);
    const a = await resolveWorkspace("synthetic-workspace-export-a-" + randomUUID()),
      b = await resolveWorkspace("synthetic-workspace-export-b-" + randomUUID());
    let access = "active";
    const owned: string[] = [];
    const expectedEvents = Array.from({ length: 5001 }, (_, i) => ({
      id: randomUUID(),
      workspaceId: a.workspaceId,
      actorId: a.identityId,
      entityId: a.workspaceId,
      action: `OWNED_SYNTHETIC_${i}_${"x".repeat(2000)}`,
    }));
    const lateEvent = {
      id: randomUUID(),
      workspaceId: a.workspaceId,
      actorId: a.identityId,
      entityId: a.workspaceId,
      action: "NEW_DATED_COPY_ONLY",
    };
    let mutateSnapshot = false;
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      res.locals.valoActor = req.headers.cookie === "synthetic=B" ? b : a;
      next();
    });
    app.use(
      makeWorkspaceExportRouter(async (_req, actor) =>
        assertWorkspaceDownloadSession(
          actor,
          { userId: actor.identityId, sessionId: "controlled-original-session" },
          {
            session: async () => ({
              status: access === "revoked" ? "revoked" : "active",
              userId: actor.identityId,
            }),
            user: async () => ({
              id: actor.identityId,
              banned: access === "suspended",
              locked: false,
              primaryEmailAddressId: "primary",
              emailAddresses: [{ id: "primary", verification: { status: "verified" } }],
            }),
          },
        ),
      ),
    );
    app.use((err: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.status(err instanceof ValoProblem ? err.status : 503).json({ error: "Controlled rejection" });
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/workspace/data-exports`;
    const row = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
    const create = async () => {
      const j = await createWorkspaceExport(a, randomUUID());
      owned.push(j.id);
      return j;
    };
    const run = async (id: string) =>
      executeWorkspaceExport(id, a.workspaceId, (await row(id)).queueId, {
        onPage: async (section, count) => {
          if (mutateSnapshot && section === "yourActivity" && count === 500) {
            mutateSnapshot = false;
            await db.insert(valoEvents).values(lateEvent);
          }
        },
      });
    const download = (id: string, headers: Record<string, string> = {}) =>
      fetch(`${base}/${id}/download`, { headers });
    try {
      await db.insert(valoEvents).values(expectedEvents);
      await t.test(
        "GET does not prepare; background completion gives an immutable private result and ranges",
        async () => {
          const j = await create();
          assert.equal((await download(j.id)).status, 409);
          assert.equal((await row(j.id)).attempts, 0);
          mutateSnapshot = true;
          await run(j.id);
          const response = await download(j.id),
            body = await response.text();
          assert.equal(response.status, 200);
          assert.ok(Buffer.byteLength(body) > 8000000);
          const value = JSON.parse(body);
          assert.equal(value.complete, true);
          assert.equal(value.data.yourActivity.length, 5001);
          assert.deepEqual(
            value.data.yourActivity.map((r: { id: string }) => r.id).sort(),
            expectedEvents.map((r) => r.id).sort(),
          );
          const result = await row(j.id),
            [object] = await db.select().from(attempts).where(eq(attempts.id, result.currentAttemptId!));
          assert.ok([403, 404].includes(await anonymousPrivateFileStatus(object!.objectKey)));
          const range = await download(j.id, {
            Range: "bytes=0-99",
            "If-Range": response.headers.get("ETag")!,
          });
          assert.equal(range.status, 206);
          assert.equal(await range.text(), body.slice(0, 100));
          assert.equal((await row(j.id)).attempts, 1);
          assert.equal((await download(j.id, { Cookie: "synthetic=B" })).status, 404);
          for (const mode of ["revoked", "suspended", "membership"]) {
            access = mode;
            if (mode === "membership")
              await db
                .update(valoMemberships)
                .set({ active: "no" })
                .where(eq(valoMemberships.workspaceId, a.workspaceId));
            const denied = await download(j.id);
            assert.equal(denied.status, mode === "revoked" ? 401 : 403);
            assert.equal(denied.headers.get("Content-Disposition"), null);
            access = "active";
            await db
              .update(valoMemberships)
              .set({ active: "yes" })
              .where(eq(valoMemberships.workspaceId, a.workspaceId));
          }
          await cancelWorkspaceExport(a, j.id, result.version);
          assert.equal((await download(j.id)).status, 409);
        },
      );
      await t.test(
        "actual SIGKILL before native upload recovers the same job using a fresh full snapshot",
        async () => {
          const j = await create(),
            child = spawn(
              process.execPath,
              [
                "--import",
                "tsx",
                "src/scripts/workspace-export-interruption-child.ts",
                j.id,
                a.workspaceId,
                a.identityId,
              ],
              { cwd: process.cwd(), env: process.env, stdio: ["ignore", "ignore", "pipe", "ipc"] },
            );
          try {
            await bounded(
              Promise.race([
                once(child, "message"),
                once(child, "exit").then(() => {
                  throw Error("CHILD_EXITED_EARLY");
                }),
              ]),
            );
            const exit = once(child, "exit");
            child.kill("SIGKILL");
            await exit;
            await db
              .update(jobs)
              .set({ leaseUntil: new Date(0) })
              .where(eq(jobs.id, j.id));
            await recoverWorkspaceExports(a.workspaceId);
            await run(j.id);
            assert.equal((await row(j.id)).status, "ready");
            assert.equal((await row(j.id)).attempts, 2);
            const result = await download(j.id);
            assert.equal(result.status, 200);
            const data = (await result.json()) as {
              data: { yourActivity: { id: string }[] };
              counts: { yourActivity: number };
            };
            assert.equal(data.counts.yourActivity, 5002);
            assert.deepEqual(
              data.data.yourActivity.map((r) => r.id).sort(),
              [...expectedEvents.map((r) => r.id), lateEvent.id].sort(),
            );
          } finally {
            if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
          }
        },
      );
      console.log(
        JSON.stringify({
          nativePrivateStorage: true,
          controlledIdentityReader: true,
          realManagedProviderSession: false,
          realProcessSigkill: true,
          leaseExpiry: "owned fixture clock advanced",
          externalMessages: 0,
          inferenceCalls: 0,
          productionProof: false,
        }),
      );
    } finally {
      await db
        .update(valoMemberships)
        .set({ active: "yes" })
        .where(eq(valoMemberships.workspaceId, a.workspaceId));
      const objects = await db.select().from(attempts).where(eq(attempts.workspaceId, a.workspaceId));
      for (const o of objects) await workspaceExportStorage.remove(o.objectKey);
      await db.delete(attempts).where(eq(attempts.workspaceId, a.workspaceId));
      await db.delete(jobs).where(eq(jobs.workspaceId, a.workspaceId));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, [a.workspaceId, b.workspaceId]));
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await pool.end();
    }
  },
);
