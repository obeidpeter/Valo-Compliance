import { test } from "node:test";
import assert from "node:assert/strict";
import { editorialCaseOutcome, type EditorialCaseBatch } from "./editorial-case-outcomes";
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
const batch = (at: string, results: unknown[]): EditorialCaseBatch => {
  const manifest = prepareEditorialCaseManifest("EVAL-EDP-C019", {}, new Date(at));
  return {
    id: `finite-submanifest:${at}`,
    manifest,
    results: Object.fromEntries(
      manifest.works.flatMap((w, i) => (results[i] === undefined ? [] : [[w.key, results[i]]])),
    ),
  };
};

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
  assert.equal(editorialCaseOutcome("EVAL-EDP-C060", [own]).reason, "case_review_pair_not_prepared");
  assert.equal(editorialCaseOutcome("EVAL-EDP-C041", [own]).reason, "no_admitted_review_pair");
});
