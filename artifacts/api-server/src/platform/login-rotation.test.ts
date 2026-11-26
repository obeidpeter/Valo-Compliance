import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

// SEC-002 ("rotation tests pass") and OPS-004 ("rotation and emergency revocation are rehearsed"), for
// the four database logins (docs/valo/secret-rotation.md). On a cluster of its own that asks for
// passwords, with every migration applied, each login is rotated with its own script, revoked in an
// emergency and restored, and the work that needs it is watched throughout. Nothing else is touched:
// the cluster is made and removed here, and no setting from the environment is read.
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../../../..");
const synthetic = () => `synthetic-rotation-${randomBytes(18).toString("hex")}`;

async function freePort() {
  const server = createServer();
  await new Promise<void>((ok, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", ok);
  });
  const address = server.address();
  await new Promise((ok) => server.close(ok));
  assert.ok(address && typeof address === "object");
  return address.port;
}

/** A login's script, as an operator runs it: it sets the password and prints the connection string. */
async function runScript(script: string, setting: string, databaseUrl: string, password: string) {
  const { stdout } = await exec(process.execPath, [join(root, "lib/db/scripts", script), "--print-url"], {
    cwd: root,
    env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, [setting]: password },
  });
  return stdout.trim();
}

/** Who a connection string logs in as, or the code the database refused it with. */
async function logIn(url: string) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    return (await client.query<{ login: string }>("SELECT session_user AS login")).rows[0]!.login;
  } catch (error) {
    return `refused:${(error as { code?: string }).code}`;
  } finally {
    await client.end().catch(() => undefined); // A refused client has nothing left to close.
  }
}

/** The codes an error carries, its own and its causes': Drizzle reports a failed query with the database's
 * or the login's error as its cause, and the logs keep each code down the chain (platform/safe-error.ts). */
function codesOf(error: unknown) {
  const codes: string[] = [];
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    e = (e as { cause?: unknown }).cause;
  }
  return codes;
}

/** The work stops, and its error carries the login's own code. */
async function stopsWith(run: () => Promise<unknown>, code: string) {
  const error = await run().then(
    () => undefined,
    (failure: unknown) => failure,
  );
  assert.ok(error, "the work stopped");
  assert.ok(codesOf(error).includes(code), `it stopped with ${code}, not ${codesOf(error).join(", ")}`);
}

test("each database login is rotated, revoked in an emergency and restored, and the work that needs it stops with its own code while the process carries on (SEC-002, OPS-004)", async (t) => {
  assert.equal(
    process.env.VALO_RUN_LOGIN_ROTATION,
    "synthetic-isolated-only",
    "Explicit isolated-cluster test opt-in required",
  );
  assert.notEqual(userInfo().uid, 0, "PostgreSQL's own tools refuse to run as root");
  const directory = await mkdtemp(join(tmpdir(), "valo-login-rotation-"));
  const data = join(directory, "data"),
    port = await freePort(),
    owner = "valo_rotation_owner",
    ownerPassword = synthetic();
  const tools = { cwd: directory, env: { PATH: process.env.PATH } };
  let started = false;
  try {
    await writeFile(join(directory, "owner-password"), ownerPassword + "\n", { mode: 0o600 });
    await exec(
      "initdb",
      ["-D", data, "-U", owner, "--auth=scram-sha-256", `--pwfile=${join(directory, "owner-password")}`],
      tools,
    );
    await exec(
      "pg_ctl",
      [
        "-D",
        data,
        "-l",
        join(directory, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -k ${directory}`,
        "-w",
        "start",
      ],
      tools,
    );
    started = true;
    const databaseUrl = `postgresql://${owner}:${ownerPassword}@127.0.0.1:${port}/postgres`;
    const ownerClient = new pg.Client({ connectionString: databaseUrl });
    await ownerClient.connect();
    try {
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(drizzle(ownerClient), { migrationsFolder: join(root, "lib/db/drizzle") });

      const logins = [
        {
          role: "valo_workspace_login",
          script: "workspace-login.mjs",
          password: "VALO_WORKSPACE_LOGIN_PASSWORD",
          setting: "VALO_CUSTOMER_DATABASE_URL",
          code: "DB_WORKSPACE_SCOPE_UNAVAILABLE",
        },
        {
          role: "valo_publisher_login",
          script: "publisher-login.mjs",
          password: "VALO_PUBLISHER_LOGIN_PASSWORD",
          setting: "VALO_PUBLISHER_DATABASE_URL",
          code: "VALO_PUBLISHER_LOGIN_UNAVAILABLE",
        },
        {
          role: "valo_drafter_login",
          script: "drafter-login.mjs",
          password: "VALO_DRAFTER_LOGIN_PASSWORD",
          setting: "VALO_DRAFTER_DATABASE_URL",
          code: "VALO_DRAFTER_LOGIN_UNAVAILABLE",
        },
        {
          role: "valo_reviewer_login",
          script: "reviewer-login.mjs",
          password: "VALO_REVIEWER_LOGIN_PASSWORD",
          setting: "VALO_REVIEWER_DATABASE_URL",
          code: "VALO_REVIEWER_LOGIN_UNAVAILABLE",
        },
      ].map((login) => ({
        ...login,
        before: synthetic(),
        after: synthetic(),
        urls: { before: "", after: "" },
      }));
      // Each login is first enabled as an operator would, with the password it has before the rotation.
      for (const login of logins) {
        login.urls.before = await runScript(login.script, login.password, databaseUrl, login.before);
        const url = new URL(login.urls.before);
        url.password = login.after;
        login.urls.after = url.toString();
      }

      // This process is given each login's connection with its password after the rotation, as the
      // secret store would hold it once the operator stored the new one.
      Object.assign(process.env, {
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: synthetic(),
        ...Object.fromEntries(logins.map((login) => [login.setting, login.urls.after])),
      });
      const { db, pool, runInWorkspaceScope, onConnectionFailure } = await import("@workspace/db");
      const { sql } = await import("drizzle-orm");
      const { assertPublisherCanLogIn } = await import("../modules/publication/publication-publisher");
      const { assertDrafterCanLogIn } = await import("../modules/publication/drafting-login");
      const { assertReviewerCanLogIn } = await import("../modules/editorial/operational-review");
      const reported: { login: string; code: unknown }[] = [];
      const stopReporting = onConnectionFailure((error, login) =>
        reported.push({ login, code: (error as { code?: unknown }).code }),
      );
      const endedFor = (login: string) => reported.filter((failure) => failure.login === login);
      // The work each login is for, as its first check runs it.
      const work: Record<string, () => Promise<unknown>> = {
        valo_workspace_login: async () => {
          // The query is started inside the scope: Drizzle starts a query only when it is awaited.
          const { rows } = await runInWorkspaceScope(
            randomUUID(),
            async () => await db.execute<{ login: string }>(sql`SELECT session_user AS login`),
          );
          assert.equal(rows[0]?.login, "valo_workspace_login");
        },
        valo_publisher_login: assertPublisherCanLogIn,
        valo_drafter_login: assertDrafterCanLogIn,
        valo_reviewer_login: assertReviewerCanLogIn,
      };
      try {
        for (const login of logins) {
          const run = work[login.role]!;
          await t.test(
            `${login.role}: a rotation the process has not caught up with stops its work with ${login.code}`,
            async () => {
              await stopsWith(run, login.code);
            },
          );
          await t.test(
            `${login.role}: rotated with its script, the old password is refused and the new one works`,
            async () => {
              assert.equal(
                await runScript(login.script, login.password, databaseUrl, login.after),
                login.urls.after,
              );
              assert.equal(await logIn(login.urls.before), "refused:28P01");
              assert.equal(await logIn(login.urls.after), login.role);
              await run();
            },
          );
          await t.test(
            `${login.role}: revoked in an emergency, its open sessions end, its work stops with ${login.code} and the process carries on`,
            async () => {
              const before = endedFor(login.role).length;
              await ownerClient.query(`ALTER ROLE ${login.role} NOLOGIN`);
              const { rows } = await ownerClient.query<{ ended: boolean }>(
                "SELECT pg_terminate_backend(pid) AS ended FROM pg_stat_activity WHERE usename = $1",
                [login.role],
              );
              assert.ok(rows.length >= 1, "the work had left a session open in its pool");
              // The session the pool held idle ends: the pool reports it, and nothing is thrown.
              for (let i = 0; i < 100 && endedFor(login.role).length === before; i++) await sleep(50);
              // Reported with the code the database ends a session with: admin_shutdown.
              assert.deepEqual(
                endedFor(login.role)
                  .slice(before)
                  .map((failure) => failure.code),
                Array(endedFor(login.role).length - before).fill("57P01"),
              );
              assert.ok(endedFor(login.role).length > before, "the ended session was reported");
              assert.equal(await logIn(login.urls.after), "refused:28000");
              await stopsWith(run, login.code);
              // The application's own connection is not this login's, and goes on working.
              assert.deepEqual((await db.execute(sql`SELECT 1 AS one`)).rows, [{ one: 1 }]);
            },
          );
          await t.test(`${login.role}: restored with its script, its work goes on`, async () => {
            assert.equal(
              await runScript(login.script, login.password, databaseUrl, login.after),
              login.urls.after,
            );
            assert.equal(await logIn(login.urls.after), login.role);
            await run();
          });
        }
      } finally {
        stopReporting();
        await pool.end();
      }
    } finally {
      await ownerClient.end();
    }
  } finally {
    if (started) await exec("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], tools);
    await rm(directory, { recursive: true, force: true });
  }
});
