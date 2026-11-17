// Last step of the CI database job. Fails when any process recorded a pooled connection
// taken while its transaction held one, except the reviewed exceptions below. It first
// runs a canary that does exactly that, to prove the check still sees one.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const apiRoot = resolve(here, "../..");
const preload = join(here, "nested-connection-preload.mjs");

/** Reviewed exceptions, matched on the frame that opened the transaction. */
const ALLOWED = [
  {
    opener: /^at snapshotExport \(.*\/src\/lib\/valo-customer-access\.ts:/,
    reason:
      "A workspace export pins a snapshot and checks access on separate short transactions, so a " +
      "revocation is seen at once. MAX_CONCURRENT_WORKSPACE_EXPORTS caps exports per process.",
  },
];

/** The first frame outside tests and test helpers names the code that opened the transaction. */
const opener = (opened) =>
  opened.find((frame) => !frame.includes(".test.") && !frame.includes("/test-support/")) ??
  opened[0] ??
  "unknown";

function recordsIn(directory) {
  let files = [];
  try {
    files = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    // No directory means no process recorded anything.
  }
  return files.flatMap((name) => JSON.parse(readFileSync(join(directory, name), "utf8")).records);
}

const canaryDirectory = mkdtempSync(join(tmpdir(), "valo-nested-canary-"));
try {
  const canary = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/test-support/nested-connection-canary.ts"],
    {
      cwd: apiRoot,
      env: { ...process.env, NODE_OPTIONS: `--import ${preload}`, VALO_NESTED_REPORT_DIR: canaryDirectory },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  const seen = recordsIn(canaryDirectory);
  if (
    canary.status !== 0 ||
    seen.length !== 1 ||
    seen[0].kind !== "pool.query" ||
    !opener(seen[0].opened).includes("nested-connection-canary.ts")
  ) {
    console.error(canary.stderr);
    console.error(
      "The nested-connection check did not see the canary's second connection; it cannot be trusted.",
    );
    process.exit(1);
  }
} finally {
  rmSync(canaryDirectory, { recursive: true, force: true });
}

const records = process.env.VALO_NESTED_REPORT_DIR ? recordsIn(process.env.VALO_NESTED_REPORT_DIR) : [];
const unexpected = new Map();
let allowed = 0;
for (const record of records) {
  const at = opener(record.opened);
  if (ALLOWED.some((exception) => exception.opener.test(at))) {
    allowed++;
    continue;
  }
  const key = `${record.kind} inside the transaction opened ${at}`;
  unexpected.set(key, (unexpected.get(key) ?? 0) + 1);
}
console.log(
  JSON.stringify(
    { canary: "seen", recorded: records.length, allowed, unexpected: Object.fromEntries(unexpected) },
    null,
    2,
  ),
);
if (unexpected.size) {
  console.error(
    "Code took a second pooled connection while its transaction held one. Inside a transaction, " +
      "use only that transaction's connection (AGENTS.md); enough concurrent callers otherwise exhaust the pool.",
  );
  process.exit(1);
}
