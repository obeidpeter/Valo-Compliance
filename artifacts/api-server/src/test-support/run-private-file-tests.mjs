import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
assert.equal(process.env.NODE_ENV, "development");
assert.equal(process.env.VALO_RUN_DB_TESTS, "synthetic-development-only");
assert.ok(!process.env.PRIVATE_OBJECT_DIR);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname));
assert.ok(
  !Object.entries(process.env).some(
    ([k, v]) => v && (k === "REPLIT_DEPLOYMENT" || k.startsWith("REPLIT_DEPLOYMENT_")),
  ),
);
// The test files to run with portable private files; the export recovery test by default.
const tests = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["src/modules/exports/valo-export-recovery.integration.test.ts"];
assert.ok(
  tests.every((file) => /^src\/[\w/.-]+\.integration\.test\.ts$/.test(file)),
  "integration tests only",
);
const directory = await mkdtemp(join(tmpdir(), "valo-portable-private-"));
try {
  const child = spawn(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--import",
      new URL("./private-file-process.mts", import.meta.url).href,
      "--test",
      ...tests,
    ],
    {
      env: {
        ...process.env,
        VALO_TEST_PRIVATE_FILE_DIR: directory,
        VALO_RUN_EXPORT_CRASH_TESTS: "synthetic-development-only",
      },
      stdio: "inherit",
    },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0, "Portable export/worker test process failed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
