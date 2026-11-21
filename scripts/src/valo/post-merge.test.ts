import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../../post-merge.sh", import.meta.url));

function runSetup(installExit: number, typecheckExit: number) {
  const dir = mkdtempSync(join(tmpdir(), "valo-post-merge-"));
  const log = join(dir, "commands");
  try {
    // No package installation, database connection or real schema command occurs.
    writeFileSync(
      join(dir, "pnpm"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$POST_MERGE_TEST_LOG"
if [[ "$1" == "install" ]]; then exit ${installExit}; fi
exit ${typecheckExit}
`,
      { mode: 0o755 },
    );
    const result = spawnSync("bash", [script], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
      // The fixture must never inherit provider or database credentials.
      env: { PATH: `${dir}:${process.env.PATH}`, POST_MERGE_TEST_LOG: log },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      status: result.status,
      stdout: result.stdout,
      commands: readFileSync(log, "utf8").trim().split("\n"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("post-merge setup installs and typechecks without mutating the database", () => {
  const result = runSetup(0, 0);
  assert.equal(result.status, 0);
  assert.deepEqual(result.commands, ["install --frozen-lockfile", "run typecheck"]);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    postMergeSetup: "passed",
    schemaApplied: false,
    schemaAcceptance: false,
  });
});

test("post-merge setup stops after failed installation", () => {
  const result = runSetup(37, 0);
  assert.equal(result.status, 37);
  assert.deepEqual(result.commands, ["install --frozen-lockfile"]);
  assert.equal(result.stdout.includes('"postMergeSetup":"passed"'), false);
});

test("post-merge setup reports typecheck failure instead of false success", () => {
  const result = runSetup(0, 42);
  assert.equal(result.status, 42);
  assert.deepEqual(result.commands, ["install --frozen-lockfile", "run typecheck"]);
  assert.equal(result.stdout.includes('"postMergeSetup":"passed"'), false);
});
