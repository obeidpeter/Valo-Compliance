import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
test("raw Paystack contract checks run with no database or provider credentials", () => {
  const contract = fileURLToPath(new URL("./valo-paystack-contract.test.ts", import.meta.url));
  // Every test in the contract file must run and pass, however many it holds.
  const tests = [...readFileSync(contract, "utf8").matchAll(/^test\(/gm)].length;
  assert.ok(tests >= 4, "the contract file's tests were counted");
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", contract], {
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr + "\n" + result.stdout);
  assert.match(result.stdout, new RegExp(`(?:#|ℹ) pass ${tests}\\b`));
  assert.doesNotMatch(result.stdout, /DATABASE_URL must be set|(?:#|ℹ) fail [1-9]/);
});
