import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  citationProblems,
  citationResult,
  evidenceByRequirement,
  generatedTestNames,
  jobProblems,
  namedOnlyAsSubtest,
  readCitations,
  readTestRecords,
  workflowProblems,
  type Citation,
  type TestRecord,
} from "./ci-evidence";
import { readAreaCoverage } from "./code-coverage";

const reporter = new URL("./test-results-reporter.mjs", import.meta.url).href;

/** Runs throwaway test files the way CI does: the spec reporter on stdout and the results
 * reporter beside it, both from NODE_OPTIONS. */
function runWithReporter(files: Record<string, string>, record = true) {
  const folder = mkdtempSync(join(tmpdir(), "valo-ci-evidence-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(folder, name), body);
  const results = join(folder, "results");
  mkdirSync(results);
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_OPTIONS: [
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      `--test-reporter=${reporter}`,
      `--test-reporter-destination=${join(results, "reporter-output.txt")}`,
    ].join(" "),
    VALO_TEST_RESULTS_DIR: record ? results : undefined,
  };
  // Inside a test run, a nested runner would otherwise report to this one instead.
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", ...Object.keys(files)], {
    cwd: folder,
    env,
    encoding: "utf8",
    timeout: 60000,
  });
  const records = readTestRecords(results);
  rmSync(folder, { recursive: true, force: true });
  return { run, records };
}

const cite = (file: string, name: string): Citation => ({
  requirement: "NFR-011",
  job: "foundation",
  file,
  test: name,
  proves: "controlled",
});

test("the reporter records how every test ended, and a citation passes only when all of it ran and passed", () => {
  const { run, records } = runWithReporter({
    "a.test.mjs": [
      'import test from "node:test";',
      'test("passes with its subtests", async (t) => { await t.test("inner passes", () => {}); });',
      'test("passes but skips a subtest", async (t) => { await t.test("inner skipped", { skip: "not here" }, () => {}); });',
      'test("is skipped", { skip: true }, () => {});',
      'test("is a todo", { todo: true }, () => {});',
      'test("fails", () => { throw new Error("controlled failure"); });',
    ].join("\n"),
    "b.test.mjs": 'import test from "node:test";\ntest("passes with its subtests", () => {});\n',
  });
  // The spec output CI shows is unchanged, and the failure still fails the run.
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /ℹ tests 8/);
  assert.match(run.stdout, /ℹ fail 1/);
  const outcomes = records
    .map((r) => `${r.file.split("/").at(-1)} ${r.path.join(" > ")}: ${r.status}`)
    .sort();
  assert.deepEqual(outcomes, [
    "a.test.mjs fails: fail",
    "a.test.mjs is a todo: todo",
    "a.test.mjs is skipped: skip",
    "a.test.mjs passes but skips a subtest > inner skipped: skip",
    "a.test.mjs passes but skips a subtest: pass",
    "a.test.mjs passes with its subtests > inner passes: pass",
    "a.test.mjs passes with its subtests: pass",
    "b.test.mjs passes with its subtests: pass",
  ]);
  const result = (file: string, name: string) => citationResult(cite(file, name), records);
  assert.equal(result("a.test.mjs", "passes with its subtests"), "pass");
  assert.equal(result("b.test.mjs", "passes with its subtests"), "pass");
  assert.equal(result("a.test.mjs", "passes but skips a subtest"), "not_run");
  assert.equal(result("a.test.mjs", "is skipped"), "not_run");
  assert.equal(result("a.test.mjs", "is a todo"), "not_run");
  assert.equal(result("a.test.mjs", "fails"), "fail");
  assert.equal(result("a.test.mjs", "was never written"), "not_run");
  // A file whose name only ends the same way is a different file.
  assert.equal(result("ba.test.mjs", "passes with its subtests"), "not_run");
  const problems = jobProblems(
    "foundation",
    ["passes with its subtests", "passes but skips a subtest", "fails", "was never written"].map((name) =>
      cite("a.test.mjs", name),
    ),
    records,
  );
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems.join("\n"), /"fails" \(a\.test\.mjs\) failed/);
  // A run that passes everything but does not record cannot pass a citation.
  const unrecorded = runWithReporter(
    { "c.test.mjs": 'import test from "node:test";\ntest("ok", () => {});\n' },
    false,
  );
  assert.equal(unrecorded.run.status, 0, unrecorded.run.stderr);
  assert.deepEqual(unrecorded.records, []);
  assert.equal(citationResult(cite("c.test.mjs", "ok"), unrecorded.records), "not_run");
});

test("the register cites existing tests by their exact names, and CI records, checks and collects them", () => {
  const citations = readCitations();
  assert.ok(citations.length >= 10, "the register was actually read");
  assert.deepEqual(citationProblems(citations), []);
  assert.deepEqual(workflowProblems(citations), []);
});

test("a citation must name a known requirement, job, test file and exact test name, once", () => {
  const name = "a citation must name a known requirement, job, test file and exact test name, once";
  const good = cite("scripts/src/valo/ci-evidence.test.ts", name);
  assert.deepEqual(citationProblems([good]), []);
  const only = (citation: Citation) => {
    const problems = citationProblems([citation]);
    assert.equal(problems.length, 1, problems.join("\n"));
    return problems[0]!;
  };
  assert.match(only({ ...good, requirement: "NFR-999" }), /no requirement NFR-999/);
  assert.match(only({ ...good, job: "nightly" }), /no job nightly/);
  assert.match(only({ ...good, file: "scripts/src/valo/missing.test.ts" }), /no test file/);
  assert.match(only({ ...good, file: "scripts/src/valo/ci-evidence.ts" }), /no test file/);
  assert.match(only({ ...good, test: name.slice(0, 25) }), /names no test exactly like this/);
  const twice = citationProblems([good, good]);
  assert.equal(twice.length, 1);
  assert.match(twice[0]!, /cited twice/);
});

test("a test name built from a template is accepted only when it fits the template", () => {
  const names = generatedTestNames(
    [
      "for (const fixture of fixtures) test(`${fixture.id}: ${fixture.name}`, () => {});",
      "test(`holds ${name}`, () => {});",
      'test("a fixed name", () => {});',
    ].join("\n"),
  );
  assert.equal(names.length, 2);
  const fits = (name: string) => names.some((pattern) => pattern.test(name));
  assert.ok(fits("RULE-EVAL-026: unknown workforce cannot imply exemption"));
  assert.ok(fits("holds no commercial-use rights"));
  for (const name of ["a fixed name", "holds", "RULE-EVAL-026 unknown workforce"])
    assert.ok(!fits(name), name);
  // In this repository: a generated rule scenario's name fits its file's template, a changed one does not.
  const scenario = cite(
    "scripts/src/valo/rule-evaluation.test.ts",
    "RULE-EVAL-026: unknown workforce cannot imply exemption",
  );
  assert.deepEqual(citationProblems([scenario]), []);
  assert.match(
    citationProblems([{ ...scenario, test: "RULE-EVAL-026 unknown workforce" }])[0]!,
    /names no test exactly like this/,
  );
});

// The job's check finds a citation by the top-level name of each test that ran (citationResult), so a
// citation of a subtest passes nowhere: it is refused here, before any job runs.
test("a citation naming a subtest is refused, since the job's check reads only top-level names", () => {
  const source = [
    'test("the whole proof", async (t) => {',
    '  await t.test("one part of it", async () => {});',
    "  await t.test(",
    "    'another part',",
    "    async () => {},",
    "  );",
    "});",
    'test("one part of it, also on its own", () => {});',
  ].join("\n");
  assert.equal(namedOnlyAsSubtest(source, "one part of it"), true);
  assert.equal(namedOnlyAsSubtest(source, "another part"), true);
  assert.equal(namedOnlyAsSubtest(source, "the whole proof"), false);
  assert.equal(namedOnlyAsSubtest(source, "one part of it, also on its own"), false);
  // In this repository: a database test's part is refused, and its top-level test is accepted.
  const part = cite(
    "artifacts/api-server/src/modules/tasks/valo-requirements.integration.test.ts",
    "dispatch checks opt-out before any adapter invocation",
  );
  assert.match(citationProblems([part])[0]!, /names this as a subtest; cite its top-level test/);
  assert.deepEqual(
    citationProblems([
      { ...part, test: "development saved assessments, task isolation, concurrency and reminder outbox" },
    ]),
    [],
  );
});

test("the register accepts only citations with exactly their five fields", () => {
  const root = mkdtempSync(join(tmpdir(), "valo-ci-register-"));
  mkdirSync(join(root, "docs/registers"), { recursive: true });
  const write = (register: unknown) =>
    writeFileSync(join(root, "docs/registers/ci-evidence.json"), JSON.stringify(register));
  const citation = cite("scripts/src/valo/ci-evidence.test.ts", "x");
  try {
    write({ citations: [citation] });
    assert.deepEqual(readCitations(root), [citation]);
    const { proves: _proves, ...withoutProves } = citation;
    for (const register of [
      {},
      { citations: {} },
      { citations: [withoutProves] },
      { citations: [{ ...citation, extra: "x" }] },
      { citations: [{ ...citation, test: " " }] },
    ]) {
      write(register);
      assert.throws(() => readCitations(root), /CI_EVIDENCE_REGISTER_INVALID/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CI must record, check and collect the results of every job the register cites", () => {
  const root = mkdtempSync(join(tmpdir(), "valo-ci-workflow-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  try {
    writeFileSync(
      join(root, ".github/workflows/valo-foundation.yml"),
      [
        "jobs:",
        "  foundation:",
        "    steps:",
        "      - run: pnpm test",
        '      - run: echo "NODE_OPTIONS=--import x" >> "$GITHUB_ENV"',
        "  evidence:",
        "    needs: [postgres]",
        "    steps: []",
        "",
      ].join("\n"),
    );
    const problems = workflowProblems([cite("scripts/src/valo/ci-evidence.test.ts", "x")], root);
    assert.equal(problems.length, 6, problems.join("\n"));
    assert.match(
      problems.join("\n"),
      /foundation writes NODE_OPTIONS to \$GITHUB_ENV, which the runner ignores/,
    );
    assert.match(problems.join("\n"), /foundation does not record/);
    assert.match(problems.join("\n"), /foundation does not check/);
    assert.match(problems.join("\n"), /foundation does not upload test-results-foundation/);
    assert.match(problems.join("\n"), /does not wait for the foundation job/);
    assert.match(problems.join("\n"), /does not check every citation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("after a re-run, each job's latest attempt is the one counted, and a job not re-run keeps its own", () => {
  const root = mkdtempSync(join(tmpdir(), "valo-ci-attempts-"));
  const record = (folder: string, test: string, status: TestRecord["status"]) => {
    mkdirSync(join(root, folder), { recursive: true });
    const line: TestRecord = {
      file: "scripts/src/valo/ci-evidence.test.ts",
      path: [test],
      status,
      kind: "test",
    };
    writeFileSync(join(root, folder, `${test}-${status}.jsonl`), `${JSON.stringify(line)}\n`, { flag: "a" });
  };
  const coverage = (folder: string, area: string, covered: number) => {
    mkdirSync(join(root, folder), { recursive: true });
    const counts = [covered, 10];
    const summary = { area, branches: counts, lines: counts, functions: counts, files: [] };
    writeFileSync(join(root, folder, `code-coverage-${area}.json`), JSON.stringify(summary));
  };
  try {
    // Attempt 1 of the foundation job was cancelled after one test; attempt 2 ran them all.
    record("test-results-foundation-attempt-1", "early", "pass");
    record("test-results-foundation-attempt-2", "early", "pass");
    record("test-results-foundation-attempt-2", "late", "pass");
    // A later attempt that fails is not rescued by an earlier pass.
    record("test-results-postgres-attempt-1", "flaky", "pass");
    record("test-results-postgres-attempt-3", "flaky", "fail");
    coverage("test-results-postgres-attempt-1", "payments", 9);
    coverage("test-results-postgres-attempt-3", "payments", 7);
    // The phone job was not re-run: its first attempt still counts.
    record("test-results-web-performance-attempt-1", "phone", "pass");
    const records = readTestRecords(root);
    const result = (name: string) =>
      citationResult(cite("scripts/src/valo/ci-evidence.test.ts", name), records);
    assert.equal(result("late"), "pass");
    assert.equal(result("early"), "pass");
    assert.equal(
      records.filter((r) => r.path[0] === "early").length,
      1,
      "the superseded attempt is not read",
    );
    assert.equal(result("flaky"), "fail");
    assert.equal(result("phone"), "pass");
    assert.deepEqual(
      readAreaCoverage(root).map((a) => [a.area, a.branches[0]]),
      [["payments", 7]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readiness evidence binds each citation to its test file's bytes and this run's result", () => {
  const citations = readCitations();
  const unrun = evidenceByRequirement(citations, undefined);
  const entries = [...unrun.values()].flat() as { hash: string; result: string; recordedBy: string }[];
  assert.equal(entries.length, citations.length);
  assert.ok(
    entries.every((e) => /^[a-f0-9]{64}$/.test(e.hash) && e.result === "not_run" && e.recordedBy === "ci"),
  );
  const [first] = citations;
  const passed: TestRecord[] = [
    { file: `/checkout/${first!.file}`, path: [first!.test], status: "pass", kind: "test" },
  ];
  const results = [...evidenceByRequirement([first!], passed).values()].flat() as { result: string }[];
  assert.deepEqual(
    results.map((e) => e.result),
    ["pass"],
  );
});
