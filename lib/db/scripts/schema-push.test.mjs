import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assessCommand, guardedPush } from "./schema-push.mjs";
const env = {
  NODE_ENV: "development",
  VALO_SCHEMA_PUSH_ACK: "reviewed-development-only",
  VALO_RUN_DB_TESTS: "synthetic-development-only",
};
const clean = { status: 0, stdout: "[✓] Changes applied", stderr: "" };
const verified = { status: 0, stdout: "ℹ pass 18\nℹ fail 0\nℹ skipped 0", stderr: "" };
for (const [label, output] of [
  [
    "zero-exit SQL failure",
    'error: relation "valo_document_workspace_unique" already exists\nChanges applied',
  ],
  ["ANSI-coloured error", "\u001b[31mError: failed query\u001b[0m\nChanges applied"],
  ["foreign-key failure", "Error: insert violates foreign key constraint\nChanges applied"],
  ["SQLSTATE failure", "code: '42P07'\nChanges applied"],
  ["permission failure", "permission denied for schema pgboss\nChanges applied"],
  ["query failure", "DrizzleQueryError: failed query\nChanges applied"],
  ["aborted transaction", "current transaction is aborted\nChanges applied"],
]) {
  test(label + " cannot be accepted", () => {
    let calls = 0;
    const result = guardedPush(env, [], () => {
      calls++;
      return { ...clean, stderr: output };
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.schemaAcceptance, false);
    assert.ok(result.categories.includes("SQL_ERROR_REPORTED"));
    assert.equal(calls, 1);
  });
}
for (const [label, state, args] of [
  ["production", { ...env, NODE_ENV: "production" }, []],
  ["deployed process", { ...env, REPLIT_DEPLOYMENT: "1" }, []],
  ["missing review", { ...env, VALO_SCHEMA_PUSH_ACK: undefined }, []],
  ["missing test consent", { ...env, VALO_RUN_DB_TESTS: undefined }, []],
  ["force", env, ["--force"]],
  ["injected argument", env, ["--config", "elsewhere.ts"]],
]) {
  test(label + " blocks before any subprocess", () => {
    const result = guardedPush(state, args, () => assert.fail("No command permitted"));
    assert.equal(result.exitCode, 2);
    assert.equal(result.schemaAcceptance, false);
  });
}
test("missing completion marker, killed process and nonzero exit fail closed", () => {
  for (const result of [
    { status: 0, stdout: "" },
    { ...clean, status: 1 },
    { ...clean, signal: "SIGKILL" },
    { ...clean, error: Error("timeout") },
  ])
    assert.equal(assessCommand(result).passed, false);
});
test("a clean command still requires non-skipped, successful postcondition checks", () => {
  for (const verification of [
    { status: 1, stdout: "ℹ pass 1\nℹ fail 1\nℹ skipped 0" },
    { status: 0, stdout: "ℹ pass 0\nℹ fail 0\nℹ skipped 2" },
    { status: 0, stdout: "unrecognised output" },
    { status: 0, stdout: "ℹ pass 1\nℹ fail 0\nℹ skipped 1" },
  ])
    assert.equal(guardedPush(env, [], (stage) => (stage === "schema" ? clean : verification)).exitCode, 1);
  const passed = guardedPush(env, [], (stage) => (stage === "schema" ? clean : verified));
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.schemaAcceptance, false);
  assert.equal(passed.productionCompatibilityAccepted, false);
});
test("raw credentials and query text never enter the returned evidence", () => {
  const result = guardedPush(env, [], () => ({
    ...clean,
    stderr: "Error: postgres://synthetic:DO_NOT_LOG@example.invalid/db",
  }));
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_LOG|postgres:|example.invalid/);
});
test("the installed command really exits nonzero without explicit acknowledgements", () => {
  const result = spawnSync(process.execPath, ["./scripts/schema-push.mjs"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "development", VALO_SCHEMA_PUSH_ACK: "", VALO_RUN_DB_TESTS: "" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /REVIEW_ACK_REQUIRED/);
});
