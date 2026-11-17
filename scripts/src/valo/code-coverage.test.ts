import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repositoryRoot } from "./architecture-check";
import { COVERAGE_AREAS } from "./code-coverage-areas";
import { coverageProblems, percent, runCoverage, summarize } from "./code-coverage";

test("every area lists existing product files and tests, and owns every file named like it", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: repositoryRoot, encoding: "utf8" }).split("\n");
  const owner = new Map<string, string>();
  for (const [name, area] of Object.entries(COVERAGE_AREAS)) {
    for (const path of [...area.sources, ...area.tests, ...Object.keys(area.excluded)])
      assert.ok(existsSync(join(repositoryRoot, path)), `${name}: ${path} does not exist`);
    for (const source of area.sources) {
      assert.match(source, area.pattern, `${name}: ${source} is not named like the area`);
      assert.equal(owner.get(source), undefined, `${source} is in two areas`);
      owner.set(source, name);
    }
    for (const path of Object.keys(area.excluded)) assert.match(path, area.pattern);
    for (const test of area.tests) assert.match(test, /\.test\.tsx?$/);
    for (const [test, why] of Object.entries(area.notRerun)) {
      assert.ok(existsSync(join(repositoryRoot, test)), `${name}: ${test} does not exist`);
      assert.ok(!area.tests.includes(test) && why.trim(), `${name}: ${test} is both run and not run`);
    }
    const named = tracked.filter((path) => area.pattern.test(path) && !/\.test\.tsx?$/.test(path));
    assert.deepEqual(
      named.filter((path) => !area.sources.includes(path) && !(path in area.excluded)),
      [],
      `${name}: these files belong to the area but are neither measured nor excluded with a reason`,
    );
  }
});

test("an area's totals come from its own files, and a file no test loaded is a problem", () => {
  const root = "/checkout";
  const summary = summarize(
    "payment",
    ["src/a.ts", "src/b.ts", "src/never.ts"],
    [
      { path: "/checkout/src/a.ts", lines: [9, 10], branches: [3, 4], functions: [2, 2] },
      { path: "/checkout/src/b.ts", lines: [5, 10], branches: [1, 4], functions: [1, 2] },
      { path: "/checkout/src/other.ts", lines: [0, 50], branches: [0, 20], functions: [0, 5] },
    ],
    root,
  );
  assert.deepEqual(summary.branches, [4, 8]);
  assert.deepEqual(summary.lines, [14, 20]);
  assert.deepEqual(summary.functions, [3, 4]);
  assert.deepEqual(
    summary.files.map((f) => f.path),
    ["src/a.ts", "src/b.ts"],
  );
  assert.deepEqual(summary.notLoaded, ["src/never.ts"]);
  assert.equal(percent(summary.branches), 50);
  assert.equal(percent([2, 3]), 66.66);
  const problems = coverageProblems(summary, 80);
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems[0]!, /src\/never\.ts: no test of the payment area loads it/);
  assert.match(problems[1]!, /branch coverage 50% is below 80%/);
  assert.deepEqual(coverageProblems({ ...summary, notLoaded: [] }), []);
});

test("one coverage run merges what each test file covered and reports a source no test loads", () => {
  const root = mkdtempSync(join(tmpdir(), "valo-coverage-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "src/grade.mjs"),
      [
        "export function grade(score) {",
        '  if (score > 90) return "a";',
        '  if (score > 50) return "b";',
        '  return "c";',
        "}",
      ].join("\n"),
    );
    writeFileSync(join(root, "src/never.mjs"), "export const unused = (x) => (x ? 1 : 2);\n");
    const testFile = (name: string, score: number, expected: string) =>
      writeFileSync(
        join(root, `src/${name}`),
        `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { grade } from "./grade.mjs";\ntest("grades ${score}", () => assert.equal(grade(${score}), "${expected}"));\n`,
      );
    testFile("high.test.mjs", 95, "a");
    testFile("low.test.mjs", 10, "c");
    const options = {
      area: "fixture",
      sources: ["src/grade.mjs", "src/never.mjs"],
      cwd: root,
      loader: [],
      env: {},
      resultsDirectory: join(root, "results"),
      root,
    };
    const one = runCoverage({ ...options, tests: ["src/high.test.mjs"] });
    const both = runCoverage({ ...options, tests: ["src/high.test.mjs", "src/low.test.mjs"] });
    assert.equal(one.status, 0);
    assert.equal(both.status, 0);
    const [graded] = both.summary.files;
    assert.equal(graded?.path, "src/grade.mjs");
    // Node merged both files: the low score's lines count as covered too. (V8 counts only the
    // branches it saw, so the branch total can stay the same while the lines grow.)
    assert.deepEqual(one.summary.lines, [3, 5]);
    assert.deepEqual(both.summary.lines, [5, 5]);
    assert.ok(percent(both.summary.branches) < 100, "the b branch is never taken");
    assert.deepEqual(both.summary.notLoaded, ["src/never.mjs"]);
    assert.match(coverageProblems(both.summary)[0]!, /src\/never\.mjs: no test of the fixture area loads it/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
