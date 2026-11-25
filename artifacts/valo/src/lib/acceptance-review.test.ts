import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caseFilters,
  corpusNames,
  decisionLine,
  pageIntro,
  recordedMessage,
  shownUnder,
  tallyLine,
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
