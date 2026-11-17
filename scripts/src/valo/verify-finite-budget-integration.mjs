/** Offline/isolated budget proof. Never connects to the workspace database,
 * enables owner approval or passes provider credentials to test processes. */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const exec = promisify(execFile),
  root = fileURLToPath(new URL("../../../", import.meta.url));
if (
  process.env.NODE_ENV !== "development" ||
  Object.keys(process.env).some(
    (k) => (k === "REPLIT_DEPLOYMENT" || k.startsWith("REPLIT_DEPLOYMENT_")) && !!process.env[k],
  )
)
  throw Error("EXPLICIT_NONDEPLOYED_DEVELOPMENT_REQUIRED");
const id = randomUUID(),
  out = join(root, "generated-artifacts/valo-finite-final-gate", id);
await mkdir(out, { recursive: true, mode: 0o700 });
const temp = await mkdtemp(join(tmpdir(), "valo-finite-proof-")),
  data = join(temp, "postgres");
const env = {
  NODE_ENV: "development",
  CI: "true",
  TZ: "UTC",
  SESSION_SECRET: "synthetic-finite-proof-only-not-a-provider-secret",
  VALO_RUN_DB_TESTS: "synthetic-development-only",
  VALO_ERASURE_STORAGE_PROOF: "portable",
};
for (const key of [
  "PATH",
  "HOME",
  "LANG",
  "PNPM_HOME",
  "CHROMIUM_EXECUTABLE_PATH",
  "PLAYWRIGHT_BROWSERS_PATH",
])
  if (process.env[key]) env[key] = process.env[key];
const report = {
  id,
  startedAt: new Date().toISOString(),
  checks: [],
  outcome: "running",
  providerCredentialsInherited: false,
  workspaceDatabaseUsed: false,
  paidCalls: 0,
  ownerApprovalCreated: false,
};
let started = false;
async function command(name, file, args) {
  const begin = Date.now();
  const output = createWriteStream(join(out, `${name}.log`), { flags: "wx", mode: 0o600 });
  const pending = exec(file, args, { cwd: root, env, timeout: 240000, maxBuffer: 6 * 1024 * 1024 });
  pending.child.stdout?.pipe(output, { end: false });
  pending.child.stderr?.pipe(output, { end: false });
  try {
    const r = await pending;
    return { log: r.stdout + r.stderr, elapsedMs: Date.now() - begin };
  } catch {
    throw Error(`${name}_FAILED`);
  } finally {
    output.end();
    await finished(output);
  }
}
async function check(name, args, allowedSkips = 0) {
  const r = await command(name, "pnpm", ["--filter", "@workspace/api-server", ...args]);
  const n = (key) => Number(r.log.match(new RegExp(`(?:# |ℹ )${key} (\\d+)`))?.[1] ?? NaN);
  const tests = n("tests"),
    passed = n("pass"),
    failed = n("fail"),
    skipped = n("skipped");
  assert.ok(
    tests > 0 && failed === 0 && skipped === allowedSkips && passed + skipped === tests,
    `${name}_COUNTS_INVALID`,
  );
  report.checks.push({ name, tests, passed, failed, skipped, elapsedMs: r.elapsedMs });
}
try {
  report.sourceCommit = (await command("source", "git", ["rev-parse", "HEAD"])).log.trim();
  await check("credential-free-finite-controls", ["test:valo-finite-entry"]);
  await check("no-database-and-native-detector", [
    "exec",
    "tsx",
    "--test",
    "src/lib/inference-no-database.test.ts",
  ]);
  await check("controlled-runtime-boundary", [
    "exec",
    "node",
    "--experimental-test-module-mocks",
    "--import",
    "tsx",
    "--test",
    "src/lib/valo-contract-runtime.test.ts",
  ]);
  const listener = createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  await command("initdb", "initdb", [
    "-D",
    data,
    "--username=valo_finite_proof",
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  await command("postgres-start", "pg_ctl", [
    "-D",
    data,
    "-l",
    join(out, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${temp} -F`,
    "-w",
    "start",
  ]);
  started = true;
  env.DATABASE_URL = `postgresql://valo_finite_proof@127.0.0.1:${port}/postgres`;
  const target = await command("database-identity", "psql", [
    "-X",
    "-A",
    "-t",
    "-d",
    env.DATABASE_URL,
    "-c",
    "SELECT current_database()||'|'||current_user||'|'||host(inet_server_addr())||'|'||inet_server_port()",
  ]);
  assert.equal(target.log.trim(), `postgres|valo_finite_proof|127.0.0.1|${port}`);
  report.databaseIdentity = target.log.trim();
  await command("journalled-migrations", "pnpm", [
    "--filter",
    "@workspace/db",
    "exec",
    "drizzle-kit",
    "migrate",
    "--config",
    "./drizzle.config.ts",
  ]);
  // Customer requests connect as the workspace login, as in database CI. The password is
  // random, used once and never logged.
  const loginPassword = randomBytes(18).toString("base64url"),
    customerUrl = new URL(env.DATABASE_URL);
  env.VALO_WORKSPACE_LOGIN_PASSWORD = loginPassword;
  await command("workspace-login", "node", ["lib/db/scripts/workspace-login.mjs"]);
  delete env.VALO_WORKSPACE_LOGIN_PASSWORD;
  customerUrl.username = "valo_workspace_login";
  customerUrl.password = loginPassword;
  env.VALO_CUSTOMER_DATABASE_URL = customerUrl.toString();
  // Match ordinary database CI: the reviewed queue owns a separate schema
  // migration path. Drizzle alone does not install its job tables/functions.
  env.VALO_DEV_QUEUE_MIGRATION = "reviewed-synthetic-development";
  await command("reviewed-queue-migration", "pnpm", [
    "--filter",
    "@workspace/api-server",
    "exec",
    "tsx",
    "src/scripts/queue-migration.ts",
    "apply-development",
  ]);
  delete env.VALO_DEV_QUEUE_MIGRATION;
  await check("postgres-dispatch-and-history", [
    "exec",
    "node",
    "--experimental-test-module-mocks",
    "--import",
    "tsx",
    "--test",
    "src/lib/inference-batch-dispatch.integration.test.ts",
    "src/lib/inference-history-ledger.integration.test.ts",
  ]);
  await check("actual-managed-callers", ["test:valo-managed-callers-db"]);
  await check("portable-native-forbidden-ci", ["test:valo-erasure-portable-db"], 1);
  report.outcome = "passed";
} catch (e) {
  report.outcome = "failed";
  report.failure = e.message;
  process.exitCode = 1;
} finally {
  if (started)
    try {
      await command("postgres-stop", "pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    } catch {
      report.cleanup = "cluster-stop-failed";
      report.outcome = "failed";
      process.exitCode = 1;
    }
  if (report.cleanup !== "cluster-stop-failed") await rm(temp, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await writeFile(join(out, "result.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ ...report, resultPath: join(out, "result.json") }));
}
