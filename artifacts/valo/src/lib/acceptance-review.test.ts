import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caseFilters,
  corpusNames,
  decisionLine,
  keptRunLine,
  pageIntro,
  recordedMessage,
  recordedRunMessage,
  runCaseStatusLine,
  runDecisionLine,
  runIntro,
  runScoreLine,
  runStatusesLine,
  runTallyLine,
  shownUnder,
  tallyLine,
  viewNames,
} from "./acceptance-review";

// EDP-010, RUL-008 and AI-008 (decision 0016, docs/architecture/reviewer-record.md, slice 1): the words a
// reviewer reads on the acceptance cases page, on a Lagos clock.
test("the page names the three corpora and says a decision holds only for the words as read", () => {
  assert.deepEqual(
    corpusNames.map((item) => item.label),
    ["Editorial cases", "Rule scenarios", "Customer AI cases"],
  );
  assert.match(pageIntro, /holds only for the case's words as you read them/);
  assert.match(pageIntro, /Nothing here accepts a case or a requirement/);
  assert.doesNotMatch(pageIntro, /legal advice|certif|guarantee/i);
});

test("a decision says who made it, when, and how many came before it", () => {
  const decision = { reviewer: "user_synthetic_reviewer", createdAt: "2026-11-25T08:00:00Z" };
  assert.equal(
    decisionLine({ ...decision, answer: "confirmed" }, 1),
    "Confirmed by user_synthetic_reviewer on 25 Nov 2026, 09:00",
  );
  assert.equal(
    decisionLine({ ...decision, answer: "rejected" }, 2),
    "Rejected by user_synthetic_reviewer on 25 Nov 2026, 09:00 · 1 earlier decision",
  );
  assert.equal(
    decisionLine({ ...decision, answer: "confirmed" }, 1201),
    "Confirmed by user_synthetic_reviewer on 25 Nov 2026, 09:00 · 1,200 earlier decisions",
  );
  assert.equal(
    recordedMessage("EVAL-EDP-C001", "confirmed"),
    "Recorded: you confirmed the expected outcome of EVAL-EDP-C001.",
  );
  assert.equal(
    recordedMessage("CHK-CAND-CAMA-001", "rejected"),
    "Recorded: you rejected the expected outcome of CHK-CAND-CAMA-001.",
  );
});

test("the tally and the filters count a case by its latest decision on its current words", () => {
  assert.equal(tallyLine(80, 3, 1), "3 confirmed, 1 rejected and 76 without a decision, of 80 cases.");
  assert.equal(tallyLine(60, 0, 0), "0 confirmed, 0 rejected and 60 without a decision, of 60 cases.");
  assert.deepEqual(
    caseFilters.map((item) => item.value),
    ["all", "open", "confirmed", "rejected"],
  );
  const confirmed = { answer: "confirmed" as const },
    rejected = { answer: "rejected" as const };
  assert.deepEqual(
    [shownUnder("all", null), shownUnder("all", confirmed), shownUnder("all", rejected)],
    [true, true, true],
  );
  assert.deepEqual(
    [shownUnder("open", null), shownUnder("open", confirmed), shownUnder("open", rejected)],
    [true, false, false],
  );
  assert.deepEqual(
    [shownUnder("confirmed", null), shownUnder("confirmed", confirmed), shownUnder("confirmed", rejected)],
    [false, true, false],
  );
  assert.deepEqual(
    [shownUnder("rejected", null), shownUnder("rejected", confirmed), shownUnder("rejected", rejected)],
    [false, false, true],
  );
});

test("the latest kept run says who kept it and when, the suite's own results, and where each case left for a reviewer stands", () => {
  assert.deepEqual(
    viewNames.map((item) => item.label),
    ["Expected outcomes", "The latest kept run"],
  );
  assert.match(runIntro, /A decision holds only for the run and the case as kept/);
  assert.equal(
    keptRunLine({ keptBy: "operator:synthetic-operator", createdAt: "2026-11-25T08:00:00Z", cases: 80 }),
    "Kept by synthetic-operator on 25 Nov 2026, 09:00 · 80 cases",
  );
  assert.equal(
    runStatusesLine([
      { status: "differs", count: 9 },
      { status: "matches_expected", count: 71 },
    ]),
    "The suite's own results: 9 differs, 71 matches expected.",
  );
  assert.equal(runTallyLine(9, 2, 1), "2 met, 1 not met and 6 without a decision, of 9 left for a reviewer.");
  assert.equal(
    runCaseStatusLine("differs", "The check's own calculation."),
    "The suite's result: differs. The check's own calculation.",
  );
  assert.equal(
    runCaseStatusLine("needs_evaluator_decision", null),
    "The suite's result: needs evaluator decision.",
  );
  const decision = { reviewer: "user_synthetic_reviewer", createdAt: "2026-11-25T08:00:00Z" };
  assert.equal(
    runDecisionLine({ ...decision, answer: "met" }, 1),
    "Met, by user_synthetic_reviewer on 25 Nov 2026, 09:00",
  );
  assert.equal(
    runDecisionLine({ ...decision, answer: "not_met" }, 3),
    "Not met, by user_synthetic_reviewer on 25 Nov 2026, 09:00 · 2 earlier decisions",
  );
  assert.equal(
    recordedRunMessage("CHK-CAND-NDPA-009", "met"),
    "Recorded: you decided the run met CHK-CAND-NDPA-009.",
  );
  assert.equal(
    recordedRunMessage("CHK-CAND-NDPA-009", "not_met"),
    "Recorded: you decided the run did not meet CHK-CAND-NDPA-009.",
  );
});

test("the kept run's score says how many cases count of how many, what the bar asks, what is out of it, and that it accepts no requirement", () => {
  assert.equal(
    runScoreLine({ scored: 79, counted: 4, excluded: 1, required: 79, critical: 0 }),
    "With the record, 4 of 79 scored cases count, and 79 must count. 1 case is out of the score, their expected outcome rejected. This accepts no requirement.",
  );
  assert.equal(
    runScoreLine({ scored: 60, counted: 58, excluded: 0, required: 57, critical: 2 }),
    "With the record, 58 of 60 scored cases count, and 57 must count. 2 cases are critical failures, so the bar is not met. This accepts no requirement.",
  );
});
