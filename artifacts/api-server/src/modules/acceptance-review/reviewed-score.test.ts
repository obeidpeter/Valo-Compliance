import assert from "node:assert/strict";
import test from "node:test";
import { hashedKeptCase, type KeptCase } from "./kept-runs";
import { requiredToCount, scoreKeptRun, type RecordRow } from "./reviewed-score";

// EDP-010, RUL-008 and AI-008 (decision 0016, docs/architecture/reviewer-record.md, slice 3): a kept run
// scored with the reviewer's record. Synthetic cases and rows only; nothing here accepts anything.
const hash = (c: string) => c.repeat(64);
const kept = (id: string, status: string, rest: Partial<KeptCase> = {}) =>
  hashedKeptCase({
    caseId: id,
    caseHash: hash(id.slice(-1).toLowerCase()),
    status,
    reason: null,
    review: null,
    ...rest,
  });
const left = { sections: [{ heading: "The live check", lines: ["result: Likely relevant"] }] };
const cases = [
  kept("CASE-A", "control_pass"),
  kept("CASE-B", "needs_evaluator_decision", { review: left }),
  kept("CASE-C", "blocked"),
  kept("CASE-D", "control_pass"),
  kept("CASE-E", "control_pass"),
  kept("CASE-F", "fail", { critical: true }),
];
const run = { id: "00000000-0000-4000-8000-000000000001", resultsHash: hash("9"), cases };
let n = 0;
const row = (caseId: string, answer: RecordRow["answer"], rest: Partial<RecordRow> = {}): RecordRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  judgment: answer === "met" || answer === "not_met" ? "run_outcome" : "expected_outcome",
  caseId,
  caseHash: cases.find((c) => c.caseId === caseId)!.caseHash,
  runId: null,
  resultsHash: null,
  answer,
  reason: `A synthetic reason for ${caseId}.`,
  reviewer: "user_synthetic_reviewer",
  createdAt: new Date(Date.UTC(2026, 10, 25, 9, n)).toISOString(),
  ...rest,
});
const b = cases[1]!;
const rows: RecordRow[] = [
  row("CASE-A", "rejected"),
  row("CASE-A", "confirmed"),
  row("CASE-B", "confirmed"),
  row("CASE-B", "met", { runId: run.id, resultsHash: b.resultHash }),
  row("CASE-C", "confirmed"),
  row("CASE-D", "rejected"),
  row("CASE-F", "confirmed"),
  // Decisions on other words or another run are never used.
  row("CASE-E", "confirmed", { caseHash: hash("0") }),
  row("CASE-B", "not_met", { runId: "00000000-0000-4000-8000-0000000000ff", resultsHash: b.resultHash }),
  row("CASE-B", "not_met", { runId: run.id, resultsHash: hash("0") }),
];

test("a case counts only when its expected outcome is confirmed and the suite passed it or its run was recorded as met; a rejected one is out of the score", () => {
  const score = scoreKeptRun("editorial", run, rows);
  assert.deepEqual(
    score.byCase.map((c) => [c.caseId, c.outcome, c.because]),
    [
      ["CASE-A", "counted", "confirmed_and_passed_by_the_suite"],
      ["CASE-B", "counted", "confirmed_and_met_in_this_run"],
      ["CASE-C", "not_counted", "not_passed_by_the_suite"],
      ["CASE-D", "excluded", "expected_outcome_rejected"],
      ["CASE-E", "not_counted", "expected_outcome_not_confirmed"],
      ["CASE-F", "not_counted", "not_passed_by_the_suite"],
    ],
  );
  assert.deepEqual(
    [
      score.cases,
      score.excluded,
      score.scored,
      score.counted,
      score.notCounted,
      score.required,
      score.critical,
    ],
    [6, 1, 5, 2, 3, 5, 1],
  );
  assert.equal(score.meetsBar, false);
  assert.equal(score.accepted, false);
});

test("the score names the rows it used, by id and hash, and only those", () => {
  const score = scoreKeptRun("editorial", run, rows);
  // The latest decision on each hash is the one used: CASE-A's earlier rejection is not.
  const used = new Set(score.rows.map((r) => r.id));
  assert.deepEqual(
    rows.filter((r) => used.has(r.id)).map((r) => [r.caseId, r.answer]),
    [
      ["CASE-A", "confirmed"],
      ["CASE-B", "confirmed"],
      ["CASE-B", "met"],
      ["CASE-C", "confirmed"],
      ["CASE-D", "rejected"],
      ["CASE-F", "confirmed"],
    ],
  );
  assert.ok(score.rows.every((r) => /^[a-f0-9]{64}$/.test(r.hash)));
  // A change to a row the score used changes the record's hash; a change to one it did not use does not.
  const changedUsed = rows.map((r) =>
    r.caseId === "CASE-C" ? { ...r, reason: "Another reason, written later." } : r,
  );
  assert.notEqual(scoreKeptRun("editorial", run, changedUsed).recordHash, score.recordHash);
  const changedUnused = rows.map((r) =>
    r.caseId === "CASE-E" ? { ...r, reason: "Another reason, written later." } : r,
  );
  assert.equal(scoreKeptRun("editorial", run, changedUnused).recordHash, score.recordHash);
});

test("a later decision is the one read, and a run recorded as not met does not count", () => {
  const later = [...rows, row("CASE-B", "not_met", { runId: run.id, resultsHash: b.resultHash })];
  const score = scoreKeptRun("editorial", run, later);
  const caseB = score.byCase.find((c) => c.caseId === "CASE-B")!;
  assert.deepEqual([caseB.outcome, caseB.because], ["not_counted", "run_recorded_as_not_met"]);
  // Without any run decision, a case the run left for a reviewer does not count either.
  const none = scoreKeptRun(
    "editorial",
    run,
    rows.filter((r) => r.judgment === "expected_outcome"),
  ).byCase.find((c) => c.caseId === "CASE-B")!;
  assert.deepEqual([none.outcome, none.because], ["not_counted", "run_not_recorded_as_met"]);
});

test("the bar: 95% of scored cases for the editorial and customer AI corpora, every scored scenario for the checker, with no critical failure", () => {
  assert.deepEqual(
    [requiredToCount("editorial", 60), requiredToCount("customer_ai", 60), requiredToCount("checker", 80)],
    [57, 57, 80],
  );
  const all = cases.slice(0, 2).map((c) => ({ ...c }));
  const confirmed = [
    row("CASE-A", "confirmed"),
    row("CASE-B", "confirmed"),
    row("CASE-B", "met", { runId: run.id, resultsHash: b.resultHash }),
  ];
  const passing = scoreKeptRun("editorial", { ...run, cases: all }, confirmed);
  assert.deepEqual([passing.scored, passing.counted, passing.required, passing.meetsBar], [2, 2, 2, true]);
  // A critical failure fails the bar, however many count.
  const criticalRun = { ...run, cases: [...all, kept("CASE-F", "fail", { critical: true })] };
  assert.equal(scoreKeptRun("editorial", criticalRun, confirmed).meetsBar, false);
  // A run with every case out of the score meets nothing.
  const rejected = scoreKeptRun("editorial", { ...run, cases: all.slice(0, 1) }, [row("CASE-A", "rejected")]);
  assert.deepEqual([rejected.scored, rejected.meetsBar], [0, false]);
});
