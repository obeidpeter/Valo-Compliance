import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { repositoryRoot } from "./architecture-check";
import type { TestRecord } from "./ci-evidence";
import { WORKFLOW } from "./database-tests";
import {
  repositoryPath,
  SKIPPED_IN_CI,
  skippedTestProblems,
  skipKey,
  testsSkippedEverywhere,
} from "./skipped-tests";

/** A throwaway checkout holding the given files, as the evidence job's own checkout would. */
function checkout(files: string[]) {
  const root = mkdtempSync(join(tmpdir(), "valo-skipped-tests-"));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

const record = (file: string, path: string[], status: TestRecord["status"]): TestRecord => ({
  file,
  path,
  status,
  kind: "test",
});

test("a test skipped in every job that runs it is reported unless listed with a reason", () => {
  const root = checkout(["artifacts/api/a.test.ts", "scripts/b.test.ts"]);
  try {
    // Two jobs check the repository out in different folders.
    const foundation = (file: string) => `/runner/one/repo/${file}`;
    const postgres = (file: string) => `/runner/two/repo/${file}`;
    const records = [
      record(foundation("artifacts/api/a.test.ts"), ["needs a database"], "skip"),
      record(postgres("artifacts/api/a.test.ts"), ["needs a database"], "pass"),
      record(foundation("artifacts/api/a.test.ts"), ["fails here"], "skip"),
      record(postgres("artifacts/api/a.test.ts"), ["fails here"], "fail"),
      record(foundation("artifacts/api/a.test.ts"), ["outer"], "pass"),
      record(foundation("artifacts/api/a.test.ts"), ["outer", "inner skipped everywhere"], "skip"),
      record(foundation("scripts/b.test.ts"), ["a todo"], "todo"),
      record(postgres("scripts/b.test.ts"), ["a todo"], "todo"),
      record(postgres("scripts/b.test.ts"), ["skipped once"], "skip"),
    ];
    assert.deepEqual(testsSkippedEverywhere(records, root), [
      "artifacts/api/a.test.ts :: outer > inner skipped everywhere",
      "scripts/b.test.ts :: a todo",
      "scripts/b.test.ts :: skipped once",
    ]);
    const listed = {
      "scripts/b.test.ts :: a todo": "controlled reason",
      "scripts/b.test.ts :: renamed since": "controlled reason",
      "artifacts/api/a.test.ts :: needs a database": "controlled reason",
    };
    const problems = skippedTestProblems(records, listed, root);
    assert.equal(problems.length, 4, problems.join("\n"));
    assert.match(problems[0]!, /^artifacts\/api\/a\.test\.ts :: outer > inner skipped everywhere: skipped/);
    assert.match(problems[1]!, /^scripts\/b\.test\.ts :: skipped once: skipped/);
    assert.match(problems[2]!, /renamed since: listed in SKIPPED_IN_CI but no job recorded it/);
    assert.match(problems[3]!, /needs a database: listed in SKIPPED_IN_CI but a job ran it/);
    assert.deepEqual(skippedTestProblems(records.slice(0, 5), {}, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a recorded file is matched to the repository by the longest end of its path that exists", () => {
  const root = checkout(["lib/db/scripts/x.test.mjs", "scripts/x.test.mjs"]);
  try {
    assert.equal(
      repositoryPath("/home/runner/work/r/r/lib/db/scripts/x.test.mjs", root),
      "lib/db/scripts/x.test.mjs",
    );
    assert.equal(repositoryPath("/home/ci/verify/scripts/x.test.mjs", root), "scripts/x.test.mjs");
    assert.equal(repositoryPath("/elsewhere/unknown.test.mjs", root), "/elsewhere/unknown.test.mjs");
    assert.equal(skipKey("scripts/x.test.mjs", ["outer", "inner"]), "scripts/x.test.mjs :: outer > inner");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each test listed as skipped in CI exists and says why it cannot run there", () => {
  for (const [key, reason] of Object.entries(SKIPPED_IN_CI)) {
    const [file, path] = key.split(" :: ") as [string, string];
    const source = readFileSync(join(repositoryRoot, file), "utf8");
    for (const name of path.split(" > "))
      assert.ok(source.includes(JSON.stringify(name)), `${key}: "${name}"`);
    assert.ok(reason.trim().length > 20, key);
  }
});

test("the evidence job checks for skipped tests once every job's results are complete", () => {
  const workflow = parse(readFileSync(join(repositoryRoot, WORKFLOW), "utf8")) as {
    jobs: Record<string, { needs?: string[]; steps: { run?: string; if?: string }[] }>;
  };
  const evidence = workflow.jobs.evidence!;
  const step = evidence.steps.find((s) => s.run?.includes("valo:skipped-tests"));
  assert.ok(step, "the evidence job runs valo:skipped-tests");
  assert.match(step.run!, /VALO_EVIDENCE_RESULTS_DIR=/);
  // A job that failed or was cancelled stops early, so its later tests are missing, not skipped.
  assert.match(step.if ?? "", /!contains\(needs\.\*\.result, 'failure'\)/);
  assert.match(step.if ?? "", /!contains\(needs\.\*\.result, 'cancelled'\)/);
  const recording = Object.entries(workflow.jobs)
    .filter(([, job]) => job.steps.some((s) => s.run?.includes("valo:ci-evidence --job")))
    .map(([name]) => name);
  assert.deepEqual(
    [...(evidence.needs ?? [])].sort(),
    recording.sort(),
    "the evidence job waits for every job that records results",
  );
});
