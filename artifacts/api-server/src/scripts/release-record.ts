import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { buildReleaseRecord } from "../lib/valo-release-record";

/**
 * Operator command (OPS-005). Run in the clean checkout of the release commit, against the database
 * the release runs on, it prints the release record: the commit, the migrations shipped and applied,
 * every content and rule version with its status, and docs/valo/known-issues.json as committed:
 *
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/release-record.ts <release sha>
 *
 * It only reads, and it refuses a checkout that is not exactly that commit.
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const [releaseSha, ...extra] = process.argv.slice(2);
try {
  if (!releaseSha || extra.length) throw Error("RELEASE_RECORD_ARGUMENTS_INVALID");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  if (git("rev-parse", "HEAD").trim() !== releaseSha || git("status", "--porcelain", "--untracked-files=no"))
    throw Error("CLEAN_RELEASE_CHECKOUT_REQUIRED");
  const record = await buildReleaseRecord(pool, {
    releaseSha,
    journalPath: join(root, "lib/db/drizzle/meta/_journal.json"),
    knownIssuesPath: join(root, "docs/valo/known-issues.json"),
  });
  process.stdout.write(`${JSON.stringify(record)}\n`);
} catch (error) {
  console.error(
    error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : "RELEASE_RECORD_FAILED",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
