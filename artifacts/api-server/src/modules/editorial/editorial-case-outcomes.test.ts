import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertEditorialCasePrerequisite,
  editorialCaseOutcome,
  type EditorialCaseBatch,
} from "./editorial-case-outcomes";
import { prepareEditorialCaseManifest } from "./editorial-case-reviews";

const answer = (verdict: "pass" | "hold") => ({
  verdict,
  findings: verdict === "hold" ? ["Synthetic finding"] : [],
  missingEvidence: [],
  observations: [],
  enhancedChecks: ["controlling_text", "amendments", "effective_dates", "exceptions", "jurisdiction"].map(
    (name) => ({ name, result: "fail", passage: "", note: "Synthetic" }),
  ),
});
const completion = (content: unknown, finish = "stop") => ({
  id: `synthetic-${Math.random()}`,
  model: "gpt-5.4-mini",
  created: 0,
  choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }],
});
const batchFor = (caseId: string, at: string, results: unknown[]): EditorialCaseBatch => {
  const manifest = prepareEditorialCaseManifest(caseId, {}, new Date(at));
  return {
    id: `finite-submanifest:${caseId}:${at}`,
    manifest,
    results: Object.fromEntries(
      manifest.works.flatMap((w, i) => (results[i] === undefined ? [] : [[w.key, results[i]]])),
    ),
  };
};
const batch = (at: string, results: unknown[]) => batchFor("EVAL-EDP-C019", at, results);

test("a case with both reviews of its latest pair awaits an evaluator, with each verdict as given", () => {
  const older = batch("2026-11-20T10:00:00.000Z", [completion(answer("pass")), completion(answer("pass"))]),
    latest = batch("2026-11-20T11:00:00.000Z", [completion(answer("pass")), completion(answer("hold"))]);
  const outcome = editorialCaseOutcome("EVAL-EDP-C019", [latest, older]);
  assert.equal(outcome.status, "needs_evaluator_decision");
  assert.ok("reviews" in outcome);
  assert.equal(outcome.batchId, latest.id);
  assert.deepEqual(
    outcome.reviews.map((r) => [r!.role, r!.verdict]),
    [
      ["factual", "pass"],
      ["challenge", "hold"],
    ],
  );
});

test("a missing, cut-off or invalid review leaves the case blocked, never passed", () => {
  for (const results of [
    [completion(answer("hold")), undefined],
    [completion(answer("hold")), completion(answer("hold"), "length")],
    [completion(answer("hold")), completion({ verdict: "pass" })],
  ]) {
    const outcome = editorialCaseOutcome("EVAL-EDP-C019", [batch("2026-11-20T10:00:00.000Z", results)]);
    assert.deepEqual(
      { status: outcome.status, reason: outcome.reason },
      { status: "blocked", reason: "review_pair_incomplete" },
    );
  }
});

test("only the case's own admitted pairs for its current candidate count", () => {
  const own = batch("2026-11-20T10:00:00.000Z", [completion(answer("hold")), completion(answer("hold"))]);
  const other = { ...own, manifest: prepareEditorialCaseManifest("EVAL-EDP-C018", {}, new Date()) };
  assert.equal(editorialCaseOutcome("EVAL-EDP-C019", [other]).reason, "no_admitted_review_pair");
  const changed = structuredClone(own);
  for (const w of changed.manifest.works) w.candidateHash = "a".repeat(64);
  assert.equal(editorialCaseOutcome("EVAL-EDP-C019", [changed]).reason, "no_admitted_review_pair");
  assert.equal(editorialCaseOutcome("EVAL-EDP-C019", []).reason, "no_admitted_review_pair");
  assert.equal(editorialCaseOutcome("EVAL-EDP-C060", [own]).reason, "prerequisite_not_met");
  assert.equal(editorialCaseOutcome("constructor", [own]).reason, "case_review_pair_not_prepared");
  assert.equal(editorialCaseOutcome("EVAL-EDP-C041", [own]).reason, "no_admitted_review_pair");
});

const pass = completion(answer("pass")),
  hold = completion(answer("hold"));
const [t1, t2, t3] = ["2026-11-20T10:00:00.000Z", "2026-11-20T11:00:00.000Z", "2026-11-20T12:00:00.000Z"];

test("C060's reviews count only after C018's candidate was held by its real reviews in an earlier pair", () => {
  const c060 = batchFor("EVAL-EDP-C060", t2, [pass, pass]);
  const outcome = (...prior: EditorialCaseBatch[]) => editorialCaseOutcome("EVAL-EDP-C060", [c060, ...prior]);
  const notMet = { status: "blocked", reason: "prerequisite_not_met", batchId: c060.id };
  const brief = (o: ReturnType<typeof outcome>) => ({
    status: o.status,
    reason: o.reason,
    batchId: "batchId" in o ? o.batchId : undefined,
  });
  assert.deepEqual(brief(outcome()), notMet, "no C018 pair");
  assert.deepEqual(brief(outcome(batchFor("EVAL-EDP-C018", t1, [pass, pass]))), notMet, "C018 passed");
  assert.deepEqual(brief(outcome(batchFor("EVAL-EDP-C018", t1, [hold]))), notMet, "C018 incomplete");
  assert.deepEqual(brief(outcome(batchFor("EVAL-EDP-C018", t3, [hold, hold]))), notMet, "held only later");
  const changed = batchFor("EVAL-EDP-C018", t1, [hold, hold]);
  for (const w of changed.manifest.works) w.candidateHash = "a".repeat(64);
  assert.deepEqual(brief(outcome(changed)), notMet, "another candidate's hold");
  // Held before C060's pair was prepared: C060 awaits an evaluator, naming the holding pair, even
  // after a later C018 pair passes.
  const held = batchFor("EVAL-EDP-C018", t1, [pass, hold]);
  for (const prior of [[held], [held, batchFor("EVAL-EDP-C018", t3, [pass, pass])]]) {
    const o = outcome(...prior);
    assert.equal(o.status, "needs_evaluator_decision");
    assert.ok("prerequisite" in o && "reviews" in o);
    assert.deepEqual(o.prerequisite, { caseId: "EVAL-EDP-C018", batchId: held.id });
    assert.equal(o.batchId, c060.id);
    assert.deepEqual(
      o.reviews.map((r) => r.verdict),
      ["pass", "pass"],
    );
  }
  // Without its own pair, C060 is blocked with the prerequisite met.
  const waiting = editorialCaseOutcome("EVAL-EDP-C060", [held]);
  assert.equal(waiting.reason, "no_admitted_review_pair");
  assert.ok("prerequisite" in waiting);
});

test("the runner prepares, admits and runs C060 only while C018's latest pair holds", () => {
  assert.equal(assertEditorialCasePrerequisite("EVAL-EDP-C019", []), null);
  const held = batchFor("EVAL-EDP-C018", t1, [hold, pass]);
  assert.deepEqual(assertEditorialCasePrerequisite("EVAL-EDP-C060", [held]), {
    caseId: "EVAL-EDP-C018",
    batchId: held.id,
  });
  for (const batches of [
    [],
    [batchFor("EVAL-EDP-C018", t1, [pass, pass])],
    [held, batchFor("EVAL-EDP-C018", t2, [])],
    [held, batchFor("EVAL-EDP-C018", t2, [pass, pass])],
    [batchFor("EVAL-EDP-C019", t1, [hold, hold])],
  ])
    assert.throws(
      () => assertEditorialCasePrerequisite("EVAL-EDP-C060", batches),
      /EDITORIAL_CASE_PREREQUISITE_NOT_MET/,
    );
});
