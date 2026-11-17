import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Customer requests act as the workspace's scoped database role (runInWorkspaceScope), and
 * row-level security limits that role to the workspace's rows. These checks run queries with
 * no workspace filter at all, so only the database can be keeping workspaces apart.
 */
test(
  "row-level security limits customer requests to their own workspace",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const tag = randomUUID(),
      identityHeader = "x-synthetic-identity";
    t.mock.module("@clerk/express", {
      namedExports: {
        clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
        getAuth: (req: Request) => {
          const id = req.header(identityHeader);
          const synthetic = id?.startsWith(`synthetic-rls-${tag}-`) ? id : null;
          return { userId: synthetic, sessionId: synthetic ? `sess_${synthetic}` : null };
        },
        clerkClient: {
          sessions: {
            getSession: async (id: string) => ({ status: "active", userId: id.slice("sess_".length) }),
          },
          users: {
            getUser: async (id: string) => ({
              id,
              banned: false,
              locked: false,
              primaryEmailAddressId: "primary",
              emailAddresses: [
                {
                  id: "primary",
                  emailAddress: "synthetic@example.invalid",
                  verification: { status: "verified" },
                },
              ],
            }),
          },
        },
      },
    });
    const { default: express } = await import("express");
    const { inArray, sql } = await import("drizzle-orm");
    const {
      db,
      pool,
      createPool,
      runInWorkspaceScope,
      valoAIDrafts,
      valoDocuments,
      valoWorkspaces,
      WORKSPACE_SCOPE_UNAVAILABLE_CODE,
    } = await import("@workspace/db");
    const { resolveWorkspace, saveProfile, createDocument } = await import("../lib/valo-store");
    const { syntheticDocument, syntheticProfile } = await import("../lib/valo-test-fixtures");
    const { verifiedWorkspace } = await import("../middlewares/valo-identity");

    const identities = [`synthetic-rls-${tag}-a`, `synthetic-rls-${tag}-b`];
    const [a, b] = await Promise.all(identities.map((identity) => resolveWorkspace(identity)));
    const documents: Record<string, string> = {};
    for (const actor of [a!, b!]) {
      await saveProfile(actor, { expectedRevision: 0, profile: syntheticProfile });
      documents[actor.workspaceId] = (await createDocument(actor, syntheticDocument)).id;
    }
    const mine = (workspaceId: string) => [documents[workspaceId]];
    // Every query below omits its workspace filter; the two synthetic documents are the only
    // rows it may return.
    const ids = (rows: { id: string }[]) =>
      rows.map((row) => row.id).filter((id) => Object.values(documents).includes(id));
    const unfiltered = () => db.select({ id: valoDocuments.id }).from(valoDocuments).then(ids);

    await t.test("every way the pool runs a query is scoped", async () => {
      await runInWorkspaceScope(a!.workspaceId, async () => {
        assert.deepEqual(await unfiltered(), mine(a!.workspaceId), "drizzle query");
        assert.deepEqual(
          await db.transaction(async (tx) =>
            ids(await tx.select({ id: valoDocuments.id }).from(valoDocuments)),
          ),
          mine(a!.workspaceId),
          "transaction",
        );
        assert.deepEqual(
          ids((await pool.query("select id from valo_documents")).rows),
          mine(a!.workspaceId),
          "pool.query",
        );
        const client = await pool.connect();
        try {
          assert.deepEqual(
            ids((await client.query("select id from valo_documents")).rows),
            mine(a!.workspaceId),
          );
          assert.equal(
            (await client.query("select current_user as role")).rows[0].role,
            "valo_workspace_scope",
          );
        } finally {
          client.release();
        }
      });
      assert.deepEqual((await unfiltered()).sort(), Object.values(documents).sort(), "unscoped afterwards");
      assert.notEqual(
        (await db.execute(sql`select current_user as role`)).rows[0]!.role,
        "valo_workspace_scope",
      );
    });

    await t.test("another workspace's rows can be neither changed nor written", async () => {
      await runInWorkspaceScope(a!.workspaceId, async () => {
        const changed = await db.execute(
          sql`update valo_documents set id = id where id in (${documents[a!.workspaceId]}, ${documents[b!.workspaceId]})`,
        );
        assert.equal(changed.rowCount, 1, "only the workspace's own document");
        const touched = await db
          .update(valoWorkspaces)
          .set({ profileRevision: sql`profile_revision` })
          .where(sql`id = ${b!.workspaceId}`);
        assert.equal(touched.rowCount, 0, "another workspace's row is invisible to the update");
        await assert.rejects(
          db.execute(
            sql`update valo_documents set workspace_id = ${b!.workspaceId} where id = ${documents[a!.workspaceId]}`,
          ),
          (error: Error) =>
            /row-level security/.test(String((error as { cause?: Error }).cause?.message ?? error.message)),
        );
      });
    });

    const refusal = (pattern: RegExp) => (error: Error) =>
      pattern.test(String((error as { cause?: Error }).cause?.message ?? error.message));

    await t.test("the scoped role can do only what customer requests do", async () => {
      await runInWorkspaceScope(a!.workspaceId, async () => {
        // A table customer requests never use, a command they never run on a table they do
        // use, and a column they never change.
        await assert.rejects(
          db.execute(sql`select count(*) from valo_staff_assignments`),
          refusal(/permission denied for table valo_staff_assignments/),
        );
        await assert.rejects(
          db.execute(sql`delete from valo_documents where id = ${documents[a!.workspaceId]}`),
          refusal(/permission denied for table valo_documents/),
        );
        await assert.rejects(
          db.execute(
            sql`update valo_workspaces set owner_identity_id = owner_identity_id where id = ${a!.workspaceId}`,
          ),
          refusal(/permission denied for table valo_workspaces/),
        );
        // Rows customer requests lock can still be locked, but not changed.
        const locked = await db.execute(
          sql`select id from valo_memberships where workspace_id = ${a!.workspaceId} for share`,
        );
        assert.equal(locked.rows.length, 1);
        await assert.rejects(
          db.execute(sql`update valo_memberships set active = active where workspace_id = ${a!.workspaceId}`),
          refusal(/may lock rows of valo_memberships but not change them/),
        );
      });
    });

    await t.test("limits shared by every workspace still count every workspace", async () => {
      const { customerAIUsage, globalDailyLimit } = await import("../lib/valo-customer-ai");
      // Another workspace has used the whole shared daily ceiling, partly for this person.
      const drafts = Array.from({ length: globalDailyLimit }, () => ({
        id: randomUUID(),
        workspaceId: b!.workspaceId,
        actorId: identities[0]!,
        idempotencyKey: randomUUID(),
        inputHash: "0".repeat(64),
        task: "invoice",
        status: "manual_fallback",
        promptVersion: "synthetic-row-security",
        budgetReserved: true,
        preview: {},
      }));
      await db.insert(valoAIDrafts).values(drafts);
      try {
        const usage = await runInWorkspaceScope(a!.workspaceId, () => customerAIUsage(a!));
        assert.equal(usage.workspaceUsed, 0, "the workspace's own count is its own");
        assert.equal(usage.globalAvailable, false, "another workspace's reservations use the shared ceiling");
        const totals = await runInWorkspaceScope(a!.workspaceId, () =>
          db.execute<{ identity_last_minute: number }>(
            sql`select identity_last_minute from valo_customer_ai_reservations(now() - interval '1 day', now() - interval '1 minute', ${identities[0]!})`,
          ),
        );
        assert.ok(
          totals.rows[0]!.identity_last_minute >= globalDailyLimit,
          "this person's reservations in another workspace count against their own limit",
        );
      } finally {
        await db.delete(valoAIDrafts).where(
          inArray(
            valoAIDrafts.id,
            drafts.map((draft) => draft.id),
          ),
        );
      }
    });

    await t.test(
      "concurrent scopes, including a pool callback run from another scope, stay apart",
      async () => {
        const reads = Array.from({ length: 20 }, (_, i) => {
          const actor = i % 2 ? b! : a!;
          return runInWorkspaceScope(
            actor.workspaceId,
            async () => [actor.workspaceId, await unfiltered()] as const,
          );
        });
        for (const [workspaceId, seen] of await Promise.all(reads)) assert.deepEqual(seen, mine(workspaceId));
        // With one connection, B's checkout completes when A releases, so B's callback runs from
        // A's context. The scope is fixed when B asks for the connection.
        const single = createPool({ max: 1 });
        try {
          const held = await runInWorkspaceScope(a!.workspaceId, () => single.connect());
          const waiting = runInWorkspaceScope(b!.workspaceId, () =>
            single.query("select id from valo_documents").then((result) => ids(result.rows)),
          );
          await runInWorkspaceScope(a!.workspaceId, async () => held.release());
          assert.deepEqual(await waiting, mine(b!.workspaceId));
        } finally {
          await single.end();
        }
      },
    );

    await t.test("a connection released inside a scoped transaction is not reused", async () => {
      const single = createPool({ max: 1 });
      try {
        const before = await runInWorkspaceScope(a!.workspaceId, async () => {
          const client = await single.connect();
          const pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
          await client.query("begin");
          client.release();
          return pid;
        });
        const after = (await single.query("select pg_backend_pid() as pid, current_user as role")).rows[0];
        assert.notEqual(after.pid, before, "the leaked transaction's connection was destroyed");
        assert.notEqual(after.role, "valo_workspace_scope");
      } finally {
        await single.end();
      }
    });

    await t.test(
      "a database without the scoped role refuses scoped work and keeps no connection",
      async () => {
        const outsider = `synthetic_rls_outsider_${tag.replaceAll("-", "").slice(0, 12)}`,
          password = randomUUID();
        await pool.query(`CREATE ROLE ${outsider} LOGIN PASSWORD '${password}'`);
        const url = new URL(process.env.DATABASE_URL!);
        url.username = outsider;
        url.password = password;
        const outside = createPool({ connectionString: url.toString(), max: 1 });
        try {
          await assert.rejects(
            runInWorkspaceScope(a!.workspaceId, () => outside.query("select 1")),
            { code: WORKSPACE_SCOPE_UNAVAILABLE_CODE },
          );
          assert.equal(outside.totalCount, 0, "the probed connection was destroyed, not leaked");
        } finally {
          await outside.end();
          await pool.query(`DROP ROLE ${outsider}`);
        }
      },
    );

    await t.test("the identity middleware scopes the rest of each request", async () => {
      const app = express();
      app.use("/workspace", verifiedWorkspace);
      app.get("/workspace/probe", async (_req, res) => {
        res.json(await unfiltered());
      });
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      try {
        const { port } = server.address() as { port: number };
        for (const [identity, actor] of [
          [identities[0]!, a!],
          [identities[1]!, b!],
        ] as const) {
          const response = await fetch(`http://127.0.0.1:${port}/workspace/probe`, {
            headers: { [identityHeader]: identity },
          });
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), mine(actor.workspaceId));
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  },
);
