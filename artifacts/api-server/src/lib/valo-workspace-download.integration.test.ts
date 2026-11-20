import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, pool, valoEvents, valoMemberships, valoWorkspaces } from "@workspace/db";
import { resolveWorkspace } from "../modules/workspaces";
import { ValoProblem } from "../platform/valo-problem";
import { workspaceDataExport } from "../modules/privacy/valo-customer-access";
import { makeWorkspaceDataDownloadHandler } from "./valo-data-download-http";
import { assertWorkspaceDownloadSession } from "./valo-download-session";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test(
  "real paged workspace download, final authorization and disconnect cleanup",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 90000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const tag = randomUUID(),
      a = await resolveWorkspace(`synthetic-download-a-${tag}`),
      b = await resolveWorkspace(`synthetic-download-b-${tag}`);
    let mode = "active",
      scratch = "",
      finished = deferred(),
      prepared = deferred(),
      release = deferred(),
      closed = deferred();
    const marker = `SYNTHETIC_PRIVATE_${tag}`;
    const findScratch = async () => {
      for (const name of await readdir(tmpdir())) {
        if (!name.startsWith("valo-data-access-")) continue;
        const path = join(tmpdir(), name, "workspace.json");
        // Test-only inspection of this fixture's scratch; never application logging.
        try {
          if ((await readFile(path, "utf8")).includes(marker)) return path;
        } catch {
          /* another test's removed scratch */
        }
      }
      throw Error("FIXTURE_SCRATCH_MISSING");
    };
    const handler = makeWorkspaceDataDownloadHandler(async (_req, actor, phase) => {
      if (phase === "preparation") return;
      scratch = await findScratch();
      if (mode === "hold") {
        prepared.resolve();
        await release.promise;
      }
      if (mode === "membership_revoked")
        await db
          .update(valoMemberships)
          .set({ active: "no" })
          .where(eq(valoMemberships.workspaceId, a.workspaceId));
      await assertWorkspaceDownloadSession(
        actor,
        { userId: actor.identityId, sessionId: "controlled-session" },
        {
          session: async () => ({
            status: mode === "session_revoked" ? "revoked" : "active",
            userId: actor.identityId,
          }),
          user: async () => ({
            id: actor.identityId,
            banned: false,
            locked: mode === "locked",
            primaryEmailAddressId: "primary",
            emailAddresses: [
              {
                id: "primary",
                verification: { status: mode === "email_unverified" ? "unverified" : "verified" },
              },
            ],
          }),
        },
      );
    });
    const app = express();
    app.get("/api/workspace/data-export", async (req, res, next) => {
      res.set("Cache-Control", "private, no-store");
      // Controlled cookie identity, not a substitute for managed authentication acceptance.
      if (req.headers.cookie !== "synthetic_session=A") {
        res.status(401).json({ error: "Controlled sign-in required" });
        return;
      }
      res.locals.valoActor = a;
      res.once("close", () => closed.resolve());
      try {
        await handler(req, res);
      } catch (error) {
        next(error);
      } finally {
        finished.resolve();
      }
    });
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res
        .status(error instanceof ValoProblem ? error.status : 503)
        .json({ error: error instanceof Error ? error.message : "Download unavailable" });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/workspace/data-export`;
    const request = () => fetch(url, { headers: { Cookie: "synthetic_session=A" } });
    const reset = (next: string) => {
      mode = next;
      scratch = "";
      finished = deferred();
      prepared = deferred();
      release = deferred();
      closed = deferred();
    };
    try {
      await db.insert(valoEvents).values(
        Array.from({ length: 5001 }, (_, i) => ({
          id: randomUUID(),
          workspaceId: a.workspaceId,
          actorId: a.identityId,
          entityId: a.workspaceId,
          action: `${marker}_${i}_${"x".repeat(512)}`,
        })),
      );
      await db.insert(valoEvents).values({
        id: randomUUID(),
        workspaceId: b.workspaceId,
        actorId: b.identityId,
        entityId: b.workspaceId,
        action: "SYNTHETIC_OTHER_TENANT_MUST_NOT_APPEAR",
      });
      await t.test(
        "same-origin cookie download spans pages and returns a complete private attachment",
        async () => {
          reset("active");
          const response = await request();
          assert.equal(response.status, 200);
          assert.match(
            response.headers.get("content-disposition") ?? "",
            /^attachment; filename="valo-workspace-data.json"$/,
          );
          assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
          assert.equal(response.headers.get("x-content-type-options"), "nosniff");
          const text = await response.text();
          assert.equal(Number(response.headers.get("content-length")), Buffer.byteLength(text));
          const value = JSON.parse(text);
          assert.equal(value.data.yourActivity.length, 5001);
          assert.ok(
            value.data.yourActivity.every(
              (row: { workspaceId: string; actorId: string }) =>
                row.workspaceId === a.workspaceId && row.actorId === a.identityId,
            ),
          );
          assert.ok(!text.includes("SYNTHETIC_OTHER_TENANT_MUST_NOT_APPEAR"));
          assert.match(value.scope, /not complete privacy fulfilment/);
          await finished.promise;
          await assert.rejects(stat(scratch), { code: "ENOENT" });
        },
      );
      await t.test("an unauthenticated browser receives no attachment", async () => {
        const response = await fetch(url);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("content-disposition"), null);
        assert.ok(!(await response.text()).includes(marker));
      });
      for (const [blocked, status] of [
        ["session_revoked", 401],
        ["locked", 403],
        ["email_unverified", 403],
        ["membership_revoked", 403],
      ] as const) {
        await t.test(
          `${blocked} after preparation releases no private bytes and removes scratch`,
          async () => {
            reset(blocked);
            const response = await request();
            assert.equal(response.status, status);
            assert.equal(response.headers.get("content-disposition"), null);
            assert.ok(!(await response.text()).includes(marker));
            await finished.promise;
            await assert.rejects(stat(scratch), { code: "ENOENT" });
            if (blocked === "membership_revoked")
              await db
                .update(valoMemberships)
                .set({ active: "yes" })
                .where(eq(valoMemberships.workspaceId, a.workspaceId));
          },
        );
      }
      await t.test(
        "cooperative cancellation stops the actual row collector before another row is written",
        async () => {
          const controller = new AbortController();
          let rows = 0;
          await assert.rejects(
            () =>
              workspaceDataExport(
                a,
                async (chunk) => {
                  if (chunk.includes(marker) && ++rows === 23) controller.abort();
                },
                controller.signal,
              ),
            { name: "AbortError" },
          );
          assert.equal(rows, 23);
        },
      );
      await t.test(
        "browser disconnect while awaiting final session read prevents release and cleans scratch",
        async () => {
          reset("hold");
          const controller = new AbortController();
          const response = fetch(url, {
            headers: { Cookie: "synthetic_session=A" },
            signal: controller.signal,
          });
          await prepared.promise;
          controller.abort();
          await assert.rejects(response, { name: "AbortError" });
          // Await the actual socket close before unblocking the final read.
          await closed.promise;
          release.resolve();
          await finished.promise;
          await assert.rejects(stat(scratch), { code: "ENOENT" });
        },
      );
      await t.test(
        "disconnect during native transfer removes the completed private scratch file",
        async () => {
          reset("active");
          await new Promise<void>((resolve, reject) => {
            const request = get(url, { headers: { Cookie: "synthetic_session=A" } }, (response) => {
              assert.equal(response.statusCode, 200);
              response.pause();
              response.destroy();
              request.destroy();
              resolve();
            });
            request.once("error", (error) => {
              if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
            });
          });
          await finished.promise;
          await assert.rejects(stat(scratch), { code: "ENOENT" });
        },
      );
      await t.test(
        "a fresh request after an interrupted download regenerates the complete snapshot",
        async () => {
          reset("active");
          const response = await request();
          assert.equal(response.status, 200);
          const body = (await response.json()) as { data: { yourActivity: unknown[] } };
          assert.equal(body.data.yourActivity.length, 5001);
          await finished.promise;
          await assert.rejects(stat(scratch), { code: "ENOENT" });
        },
      );
    } finally {
      release.resolve();
      server.closeAllConnections();
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, [a.workspaceId, b.workspaceId]));
      await db
        .delete(valoMemberships)
        .where(inArray(valoMemberships.workspaceId, [a.workspaceId, b.workspaceId]));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, [a.workspaceId, b.workspaceId]));
      await pool.end();
    }
  },
);
