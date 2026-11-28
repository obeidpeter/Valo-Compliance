import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { test } from "node:test";
import { repositoryRoot } from "./architecture-check";

/**
 * Keeps every test running somewhere. A test file must be referenced by a package
 * script, the CI workflow or a test runner; a test script must run in CI unless it
 * is listed below with the reason it cannot.
 */
const NOT_RUN_BY_ANY_SCRIPT: Record<string, string> = {
  "artifacts/api-server/src/modules/sources/source-instruments.integration.test.ts":
    "retrieves official sources over the network; run manually with VALO_RUN_SOURCE_TESTS=official-development-only",
};

const NOT_IN_CI: Record<string, string> = {
  "@workspace/api-server test:valo-checker-browser-development": "needs a running development preview",
  "@workspace/api-server test:valo-customer-journey": "real managed sign-in against the development preview",
  "@workspace/api-server test:valo-http":
    "probes a running development preview and its data; test:valo-cross-site-db runs its request-handling checks in CI",
  "@workspace/api-server test:valo-security-http":
    "probes the development preview's real proxy; test:valo-cross-site-db sends the same forwarding headers to the API in CI",
  "@workspace/api-server test:valo-exports":
    "the native-storage run; test:valo-exports-portable-db runs the same file in CI with portable private files",
  "@workspace/api-server test:valo-erasure-native": "needs native Replit App Storage",
  "@workspace/api-server test:valo-erasure-native-db": "needs native Replit App Storage",
  "@workspace/api-server test:valo-workspace-artifact-db": "needs native Replit App Storage",
  "@workspace/api-server test:valo-source-db": "needs native Replit App Storage for retained sources",
  "@workspace/api-server test:valo-editorial-proof":
    "needs retained official sources (VALO_RUN_EDITORIAL_TESTS)",
  "@workspace/api-server test:valo-publication":
    "needs held development candidates (VALO_PUBLICATION_DB_TESTS); test:valo-publication-guards-db runs the same refusals on a synthetic candidate in CI",
  "@workspace/api-server test:valo-export-recovery":
    "runs in CI through test-support/run-private-file-tests.mjs",
  "@workspace/api-server test:valo-inference-budget": "same file runs in test:valo",
  "@workspace/api-server test:valo-inference-budget-db": "same file runs in test:valo-db-core",
  "@workspace/api-server test:valo-paystack-http": "same file runs in test:valo-disputes-db",
  "@workspace/api-server test:valo-erasure-db": "same files run in test:valo-erasure-portable-db",
  "@workspace/api-server test:valo-db":
    "aggregate of test:valo-db-core, test:valo-messages-db and test:valo-privacy-http-db",
};

/**
 * A safety switch is one row for the whole database unless it is one workspace's own: the staff pause
 * on messages, on checkout and on AI each stop that work for everyone. A test file that writes one must
 * not run beside another test file, or one file's pause stops the other's work. That happened: the
 * messages' log test found a message of its own held by the pause another file was testing
 * (docs/architecture/messages.md, "The tests and the pause"). So a test file that writes a switch is
 * run only by scripts that run one file at a time, unless it is recorded here that the switch it writes
 * is its own workspace's.
 */
const WRITES_A_SWITCH = [
  // The messages' fixture (artifacts/api-server/src/test-support/messages-fixture.ts).
  /\b(?:setPause|restorePause)\(/,
  // The staff action.
  /\b(?:pause|resume)_service\b/,
  // The table itself.
  /\.(?:insert|update|delete)\(\s*valoSafetySwitches\b/,
  /\b(?:insert\s+into|update|delete\s+from)\s+valo_safety_switches\b/i,
];
const WRITES_ONLY_ITS_OWN_WORKSPACES_SWITCH: Record<string, string> = {
  "artifacts/api-server/src/modules/ai-lanes/inference-customer-runtime.integration.test.ts":
    "writes only customer_ai_workspace:<id>, the switch of the synthetic workspace it made",
};

const packages = {
  "@workspace/api-server": "artifacts/api-server/package.json",
  "@workspace/scripts": "scripts/package.json",
  "@workspace/db": "lib/db/package.json",
};
const read = (path: string) => readFileSync(`${repositoryRoot}/${path}`, "utf8");
const workflow = read(".github/workflows/valo-foundation.yml");
const scripts = Object.fromEntries(
  Object.entries(packages).map(([name, path]) => [
    name,
    JSON.parse(read(path)).scripts as Record<string, string>,
  ]),
);
const runners = ["artifacts/api-server/src/test-support/run-private-file-tests.mjs"].map(read).join("\n");

test("every test file is run by a script, the workflow or a runner", () => {
  const files = execFileSync("git", ["ls-files", "*.test.ts", "*.test.tsx", "*.test.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  assert.ok(files.length > 100, "test files were listed");
  const referenced = [workflow, runners, ...Object.values(scripts).flatMap((s) => Object.values(s))].join(
    "\n",
  );
  const globbed = (file: string) => file.startsWith("scripts/src/valo/"); // `tsx --test ./src/valo/*.test.ts`
  const orphaned = files.filter(
    (file) => !globbed(file) && !referenced.includes(basename(file)) && !(file in NOT_RUN_BY_ANY_SCRIPT),
  );
  assert.deepEqual(orphaned, [], "add these tests to a package script that CI runs");
});

test("every test script runs in CI or says why it cannot", () => {
  const missing: string[] = [];
  for (const [name, entries] of Object.entries(scripts)) {
    // What the workflow calls, and what those scripts call in turn. A script that CI never runs vouches
    // for none of the scripts it names: `test:valo-db` names three, and the workflow calls each itself.
    const run = new Set(
      [...workflow.matchAll(new RegExp(`--filter ${name} (?:run )?([\\w:-]+)`, "g"))].flatMap(
        (m) => m[1] ?? [],
      ),
    );
    // A set's loop also visits what is added to it on the way.
    for (const script of run)
      for (const inner of (entries[script] ?? "").matchAll(/pnpm run ([\w:-]+)/g))
        if (inner[1]) run.add(inner[1]);
    for (const script of Object.keys(entries))
      if (script.startsWith("test") && !run.has(script) && !(`${name} ${script}` in NOT_IN_CI))
        missing.push(`${name} ${script}`);
  }
  assert.deepEqual(missing, [], "run these scripts in CI or add them to NOT_IN_CI with a reason");
  for (const key of Object.keys(NOT_IN_CI)) {
    const [name, script] = key.split(" ") as [keyof typeof scripts, string];
    assert.ok(scripts[name]?.[script], `${key} no longer exists; remove it from NOT_IN_CI`);
  }
});

test("a test file that writes a safety switch every workspace shares runs only in scripts that run one file at a time", () => {
  const api = "artifacts/api-server/";
  const files = execFileSync("git", ["ls-files", `${api}src`], { cwd: repositoryRoot, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.test\.(?:ts|tsx|mjs)$/.test(file));
  const writers = files.filter((file) => WRITES_A_SWITCH.some((pattern) => pattern.test(read(file))));
  // It was written for the messages' five files at least: finding fewer means it has stopped looking.
  assert.ok(writers.length >= 5, `the test files that write a switch were found (${writers.length})`);
  const commands = Object.entries(scripts["@workspace/api-server"]!).map(
    ([name, command]) => [name, command.split(/\s+/).map((word) => word.replace(/^\.\//, ""))] as const,
  );
  const problems: string[] = [];
  for (const file of writers) {
    if (file in WRITES_ONLY_ITS_OWN_WORKSPACES_SWITCH) continue;
    const running = commands.filter(([, words]) => words.includes(file.slice(api.length)));
    if (!running.length) problems.push(`${file}: no script names it, so how it runs cannot be checked`);
    for (const [name, words] of running)
      if (!words.includes("--test-concurrency=1"))
        problems.push(`${file}: ${name} runs its files side by side`);
  }
  assert.deepEqual(problems, [], "run these files in a script with --test-concurrency=1");
  for (const file of Object.keys(WRITES_ONLY_ITS_OWN_WORKSPACES_SWITCH))
    assert.ok(writers.includes(file), `${file} no longer writes a switch; remove it from the list`);
});
