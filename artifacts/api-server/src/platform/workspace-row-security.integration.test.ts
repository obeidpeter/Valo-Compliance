import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Customer requests connect as the workspace login and act as the scoped database role with a
 * credential for their workspace (runInWorkspaceScope), and row-level security limits that role
 * to the workspace's rows. These checks run queries with no workspace filter at all, so only
 * the database can be keeping workspaces apart, and run the SQL an attacker on a customer
 * connection could, so only the credential can be naming the workspace.
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
          assert.deepEqual((await client.query("select current_user, session_user")).rows[0], {
            current_user: "valo_workspace_scope",
            session_user: "valo_workspace_login",
          });
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

    await t.test("customer requests change the inference ledger only through its functions", async () => {
      const { additionalInferenceAllocation, inferenceProposal, requestDigest } =
        await import("../lib/inference-budget");
      const batchId = `synthetic-rls-batch-${tag}`,
        manifestHash = "f".repeat(64),
        policyHash = requestDigest(inferenceProposal);
      await pool.query(
        `INSERT INTO valo_inference_batches(id,policy_hash,manifest_hash,manifest,expires_at)
        VALUES($1,$2,$3,$4,now()+interval '1 day')`,
        [batchId, policyHash, manifestHash, JSON.stringify({ works: [{ key: "k1", lane: "customer" }] })],
      );
      try {
        await runInWorkspaceScope(a!.workspaceId, async () => {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const refused = async (statement: string, values: unknown[], pattern: RegExp) => {
              await client.query("SAVEPOINT probe");
              await assert.rejects(client.query(statement, values), pattern);
              await client.query("ROLLBACK TO SAVEPOINT probe");
            };
            // No direct access to the ledger, and the approved batch rows can only be locked.
            await refused("SELECT * FROM valo_inference_budgets", [], /permission denied for table/);
            await refused(
              "INSERT INTO valo_inference_budget_events(budget_id,version,action,before_hash,after_hash) VALUES('x',1,'x','x','x')",
              [],
              /permission denied for table/,
            );
            await refused(
              "UPDATE valo_inference_batches SET results = '{}' WHERE id = $1",
              [batchId],
              /may lock rows of valo_inference_batches but not change them/,
            );
            await refused(
              "SELECT * FROM valo_inference_budget_lock($1, $2)",
              [inferenceProposal.id, policyHash],
              /only the customer inference allocation/,
            );
            // Through the functions it may commit a customer change, but not erase or widen one.
            const {
              rows: [row],
            } = await client.query("SELECT state, version FROM valo_inference_budget_lock($1, $2)", [
              additionalInferenceAllocation.id,
              policyHash,
            ]);
            const commit = (state: object) =>
              client.query("SELECT valo_inference_budget_commit($1,$2,$3,$4,$5,$6) AS version", [
                additionalInferenceAllocation.id,
                row.version,
                JSON.stringify(state),
                "synthetic-row-security",
                "a".repeat(64),
                "b".repeat(64),
              ]);
            await client.query("SAVEPOINT probe");
            await assert.rejects(
              commit({
                ...row.state,
                priorUseReconciled: true,
                suspended: false,
                unboundedPrior: [],
                extra: 1,
              }),
              /may not commit an inference ledger change an unknown state field/,
            );
            await client.query("ROLLBACK TO SAVEPOINT probe");
            assert.equal((await commit(row.state)).rows[0].version, row.version + 1);
            const record = (key: string, result: object) =>
              client
                .query("SELECT valo_inference_batch_record_result($1,$2,$3,$4) AS saved", [
                  batchId,
                  key,
                  JSON.stringify(result),
                  manifestHash,
                ])
                .then((r) => r.rows[0].saved);
            assert.equal(await record("k1", { id: "synthetic-result" }), true);
            assert.equal(await record("k1", { id: "another-result" }), false, "a recorded result is kept");
            assert.equal(await record("not-in-manifest", { id: "x" }), false);
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
        });
      } finally {
        await pool.query("DELETE FROM valo_inference_batches WHERE id = $1", [batchId]);
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
        const after = await runInWorkspaceScope(
          a!.workspaceId,
          async () => (await single.query("select pg_backend_pid() as pid")).rows[0].pid,
        );
        assert.notEqual(after, before, "the leaked transaction's connection was destroyed");
        assert.equal(single.scopedTotalCount, 1);
      } finally {
        await single.end();
      }
    });

    await t.test(
      "customer requests refuse any login but the workspace login and keep no connection",
      async () => {
        const outsider = `synthetic_rls_outsider_${tag.replaceAll("-", "").slice(0, 12)}`,
          password = randomUUID();
        await pool.query(`CREATE ROLE ${outsider} LOGIN PASSWORD '${password}'`);
        const url = new URL(process.env.DATABASE_URL!);
        url.username = outsider;
        url.password = password;
        try {
          for (const [connectionString, cause] of [
            [url.toString(), /permission denied to set role/],
            // The application's own login could leave the scoped role for the application role.
            [process.env.DATABASE_URL!, /NOT_THE_WORKSPACE_LOGIN/],
            [undefined, undefined],
          ] as const) {
            const misconfigured = createPool({}, { connectionString, max: 1 });
            try {
              await assert.rejects(
                runInWorkspaceScope(a!.workspaceId, () => misconfigured.query("select 1")),
                (error: Error & { code?: string; cause?: Error }) =>
                  error.code === WORKSPACE_SCOPE_UNAVAILABLE_CODE &&
                  (!cause || cause.test(String(error.cause?.message))),
              );
              assert.equal(misconfigured.scopedTotalCount, 0, "the probed connection was destroyed");
            } finally {
              await misconfigured.end();
            }
          }
        } finally {
          await pool.query(`DROP ROLE ${outsider}`);
        }
      },
    );

    await t.test(
      "SQL on a customer connection can neither leave the scope nor name another workspace",
      async () => {
        const {
          rows: [application],
        } = await pool.query("select current_user as role");
        await runInWorkspaceScope(a!.workspaceId, async () => {
          const client = await pool.connect();
          const statement = async (text: string, values: unknown[] = []) => {
            await client.query("SAVEPOINT probe");
            try {
              return await client.query(text, values);
            } finally {
              await client.query("ROLLBACK TO SAVEPOINT probe");
            }
          };
          const seen = async () => ids((await statement("select id from valo_documents")).rows);
          try {
            await client.query("BEGIN");
            const own = (await client.query("select current_setting('valo.workspace_credential') as c"))
              .rows[0].c;
            assert.deepEqual(await seen(), mine(a!.workspaceId));
            // The keys credentials are signed with are out of reach.
            await assert.rejects(statement("select * from valo_scope_keys"), /permission denied for table/);
            // Resetting the role leaves the login, which holds nothing and cannot become the
            // application role.
            await client.query("RESET ROLE");
            assert.equal(
              (await client.query("select current_user as role")).rows[0].role,
              "valo_workspace_login",
            );
            await assert.rejects(statement("select id from valo_documents"), /permission denied for table/);
            await assert.rejects(statement("select * from valo_scope_keys"), /permission denied for table/);
            await assert.rejects(
              statement(`SET ROLE "${application.role}"`),
              /permission denied to set role/,
            );
            await client.query("SET LOCAL ROLE valo_workspace_scope");
            // Naming another workspace takes a credential only the application can sign.
            const forged = `${b!.workspaceId}:${own.split(":")[1]}:${"0".repeat(64)}`;
            await client.query("select set_config('valo.workspace_credential', $1, true)", [forged]);
            assert.deepEqual(await seen(), [], "a forged credential names no workspace");
            await client.query("select set_config('valo.workspace_credential', $1, true)", [b!.workspaceId]);
            assert.deepEqual(await seen(), [], "a bare workspace id names no workspace");
            await client.query("select set_config('valo.workspace_credential', $1, true)", [own]);
            assert.deepEqual(await seen(), mine(a!.workspaceId));
            await client.query("COMMIT");
            // A genuine credential is refused in every transaction but its own.
            await client.query("BEGIN");
            await client.query("select set_config('valo.workspace_credential', $1, true)", [own]);
            assert.deepEqual(await seen(), [], "a credential from an earlier transaction names no workspace");
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
        });
        // Another workspace's request cannot use A's credential either, even on A's connection.
        const single = createPool({ max: 1 });
        try {
          const own = await runInWorkspaceScope(
            a!.workspaceId,
            async () =>
              (await single.query("select current_setting('valo.workspace_credential') as c")).rows[0].c,
          );
          await runInWorkspaceScope(b!.workspaceId, async () => {
            const client = await single.connect();
            try {
              await client.query("BEGIN");
              await client.query("select set_config('valo.workspace_credential', $1, true)", [own]);
              assert.deepEqual(
                ids((await client.query("select id from valo_documents")).rows),
                [],
                "A's credential names no workspace in B's request",
              );
              await client.query("ROLLBACK");
            } finally {
              client.release();
            }
          });
        } finally {
          await single.end();
        }
      },
    );

    await t.test("each scoped transaction starts from the session's defaults", async () => {
      await runInWorkspaceScope(a!.workspaceId, async () => {
        const client = await pool.connect();
        try {
          // Session state that outlives a transaction: a temporary table that would be found
          // before the real one, and session settings.
          await client.query("create temp table valo_documents (id text)");
          await client.query("insert into pg_temp.valo_documents values ('synthetic-planted')");
          await client.query("set search_path = pg_temp, public");
          await client.query("set statement_timeout = '1234ms'");
          const seen = (await client.query("select id from valo_documents")).rows.map((row) => row.id);
          assert.deepEqual(ids(seen.map((id: string) => ({ id }))), mine(a!.workspaceId));
          assert.ok(
            !seen.includes("synthetic-planted"),
            "the temporary table does not stand in for the real one",
          );
          assert.deepEqual(
            (
              await client.query(
                "select current_setting('search_path') as path, current_setting('statement_timeout') as timeout",
              )
            ).rows[0],
            { path: "public, pg_temp", timeout: "0" },
          );
        } finally {
          client.release();
        }
      });
    });

    await t.test("nothing a request leaves on its connection reaches the next request", async () => {
      const single = createPool({ max: 1 });
      try {
        const before = await runInWorkspaceScope(a!.workspaceId, async () => {
          const client = await single.connect();
          try {
            await client.query("create temp table synthetic_planted (id text)");
            await client.query("prepare synthetic_planted as select 1");
            await client.query("select pg_advisory_lock(4242)");
            return (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
          } finally {
            client.release();
          }
        });
        const after = await runInWorkspaceScope(b!.workspaceId, async () => {
          const client = await single.connect();
          try {
            return (
              await client.query(`select pg_backend_pid() as pid,
                (select count(*)::int from pg_class where relpersistence = 't') as temporary,
                (select count(*)::int from pg_prepared_statements) as prepared,
                (select count(*)::int from pg_locks where pid = pg_backend_pid() and locktype = 'advisory') as locks`)
            ).rows[0];
          } finally {
            client.release();
          }
        });
        assert.deepEqual(after, { pid: before, temporary: 0, prepared: 0, locks: 0 }, "reused after a reset");
      } finally {
        await single.end();
      }
    });

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
