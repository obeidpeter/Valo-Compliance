import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { repositoryRoot } from "./architecture-check";

// OPS-001: "Use development, staging and production with distinct databases, storage
// namespaces/buckets, identity instances, PSP modes and secrets", accepted when "no live personal
// data is seeded into dev; integration tests cannot charge production accounts". Merchant calls
// refuse a live key (valo-paystack-contract.test.ts); these tests cover the data that tests,
// fixtures, operator scripts and migrations put into a test or development database.

const tracked = () =>
  execFileSync("git", ["ls-files"], { cwd: repositoryRoot, encoding: "utf8" }).split("\n").filter(Boolean);
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

/** Files whose data can reach a database: tests, fixtures, test support, operator scripts, migrations. */
function seedingFiles() {
  return tracked().filter(
    (file) =>
      /\.(ts|tsx|mjs|js|py|sh|json|sql)$/.test(file) &&
      !file.startsWith("docs/") &&
      !file.includes("/generated/") &&
      (/\.test\./.test(file) ||
        /fixture/i.test(file) ||
        file.includes("/test-support/") ||
        file.includes("/scripts/") ||
        file.startsWith("scripts/") ||
        file.startsWith("lib/db/drizzle/")),
  );
}

/** Text that looks like an address but is a URL's credentials, fed to a check that must refuse it. */
const NOT_ADDRESSES: Record<string, string> = {
  "artifacts/api-server/src/lib/valo-external-monitor.test.ts private@hc-ping.com":
    "a monitor URL carrying credentials, which the external monitor check must refuse",
};

test("development data is synthetic: every address in tests, fixtures, operator scripts and migrations uses a reserved domain", () => {
  const files = seedingFiles();
  assert.ok(files.length > 300, "the tests, fixtures, scripts and migrations were listed");
  // A local part right after "/", ":" or "." belongs to a URL's credentials or a longer token.
  const address = /(?<![\w/:.%+-])[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
  // Names reserved by RFC 2606 and RFC 6761, which never reach a real mailbox.
  const reserved = /(^|\.)(example\.(com|org|net)|test|example|invalid|localhost)$/i;
  let addresses = 0;
  const real: string[] = [];
  for (const file of files)
    for (const match of read(file).matchAll(address)) {
      addresses++;
      if (!reserved.test(match[1]!) && !(`${file} ${match[0]}` in NOT_ADDRESSES))
        real.push(`${file}: ${match[0]}`);
    }
  assert.ok(addresses > 50, "addresses were found");
  assert.deepEqual(real, [], "use an address at example.invalid, example.test or example.com");
  for (const key of Object.keys(NOT_ADDRESSES)) {
    const [file, text] = key.split(" ");
    assert.ok(read(file!).includes(text!), `remove the stale exception: ${key}`);
  }
});

test("the operator journeys that sign customers in refuse to run without a Clerk test key", () => {
  const journeys = tracked().filter(
    (file) =>
      file.startsWith("artifacts/api-server/src/scripts/") &&
      file.endsWith(".ts") &&
      read(file).includes("CLERK_SECRET_KEY"),
  );
  assert.ok(journeys.length >= 3, "the journeys were found");
  // Each throws unless it runs in development, outside a deployment, with a Clerk test key.
  for (const file of journeys) {
    const source = read(file);
    assert.match(source, /!process\.env\.CLERK_SECRET_KEY\?\.startsWith\("sk_test_"\) \|\|/, file);
    assert.match(source, /process\.env\.NODE_ENV !== "development" \|\|/, file);
    assert.match(source, /process\.env\.REPLIT_DEPLOYMENT \|\|/, file);
  }
});
