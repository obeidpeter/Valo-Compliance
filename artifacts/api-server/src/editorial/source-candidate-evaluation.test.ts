import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { digest, checkerFactsSchema, factsFromProfile } from "@workspace/valo-core";
import { evaluateSourceCandidateOffline, remainingSourceCandidateIds } from "@workspace/valo-core/checker-source-candidates";
import { bindBusinessNameCandidate } from "./business-name-candidate-binding";
import { bindRemainingSourceCandidates } from "./source-candidate-bindings";

const now = new Date("2026-11-14T23:00:00Z");
const { corpus } = bindBusinessNameCandidate(now);
const bindings = bindRemainingSourceCandidates(now);
const cases = corpus.cases.filter(c => remainingSourceCandidateIds.includes(c.sourceCandidateID as typeof remainingSourceCandidateIds[number]));
const evaluate = (id: string) => {
  const c = cases.find(c => c.caseID === id)!;
  return evaluateSourceCandidateOffline(c.sourceCandidateID as typeof remainingSourceCandidateIds[number],
    c.facts, c.assessmentDate, bindings[c.sourceCandidateID]!.binding);
};
test("60 additional authored source cases emit reproducible isolated results, not accepted oracle verdicts", async t => {
  assert.equal(cases.length, 60);
  for (const c of cases) await t.test(c.caseID, () => {
    const binding = bindings[c.sourceCandidateID]!.binding;
    const run = () => evaluateSourceCandidateOffline(c.sourceCandidateID as typeof remainingSourceCandidateIds[number],
      c.facts, c.assessmentDate, binding);
    const actual = run();
    assert.equal(actual.inputHash, digest(c.facts)); // No inconvenient input facts dropped.
    assert.deepEqual(actual, run());
    assert.equal(actual.eligibleForCustomerUse, false);
    assert.equal(actual.releasedManifestId, null);
    assert.equal(actual.createRegistrationTask, false);
    assert.equal(actual.automaticReminder, false);
    assert.equal(actual.automaticStatutoryDeadline, null);
    assert.equal(actual.stateAndLocalCoverage, "not_evaluated");
    assert.ok(["Likely relevant", "May apply", "More information needed", "Not indicated by these answers"].includes(actual.label));
  });
});
test("missing Nigerian domicile/residence cannot become the original unsupported privacy exclusion", () => {
  const actual = evaluate("CHK-CAND-NDPA-018");
  assert.equal(actual.label, "More information needed");
  assert.ok(actual.missingFacts.some(f => f.field === "controllerDomiciledInNigeria"));
  assert.ok(actual.missingFacts.some(f => f.field === "controllerResidentInNigeria"));
});
test("contradictory personal-data facts cannot become a negative recommendation", () => {
  const c = cases.find(c => c.caseID === "CHK-CAND-NDPA-001")!;
  assert.equal(evaluateSourceCandidateOffline(remainingSourceCandidateIds[0],
    { ...c.facts, processesPersonalData: false }, c.assessmentDate,
    bindings[c.sourceCandidateID]!.binding).label, "More information needed");
});
test("unincorporated partnership is not automatically excluded from the broader tax association definition", () => {
  const actual = evaluate("CHK-CAND-NTAA-009");
  assert.equal(actual.label, "More information needed");
  assert.match(actual.reason, /147/u);
});
test("zero tax, unknown turnover, nonprofit purpose and cessation do not invent a filing exemption", () => {
  for (const n of ["001", "002", "003", "007", "014", "019"])
    assert.equal(evaluate(`CHK-CAND-NTAA-${n}`).label, "Likely relevant");
});
test("imports, repackaging and therapeutic classification do not erase known national product relevance", () => {
  for (const n of ["009", "013", "016"]) {
    const actual = evaluate(`CHK-CAND-NAFDAC-${n}`);
    assert.equal(actual.label, "Likely relevant");
    assert.equal(actual.details.proceduralClassification, "Needs authority confirmation");
  }
});
test("confirmed qualifying sample permit is distinct from an unverified food-sample claim", () => {
  assert.equal(evaluate("CHK-CAND-NAFDAC-017").label, "Not indicated by these answers");
  assert.equal(evaluate("CHK-CAND-NAFDAC-017").details.continuingPermitConditions, true);
  assert.equal(evaluate("CHK-CAND-NAFDAC-018").label, "More information needed");
});
test("intentional stale and draft-only source fixtures stay held", () => {
  for (const id of ["CHK-CAND-NDPA-020", "CHK-CAND-NAFDAC-020"]) {
    assert.equal(evaluate(id).label, "More information needed");
    assert.equal(evaluate(id).details.eligibilityFaultInjection, true);
  }
});
test("all four permitted customer-label semantics are exercised without customer eligibility", () => {
  assert.deepEqual([...new Set(cases.map(c => evaluate(c.caseID).label))].sort(),
    ["Likely relevant", "May apply", "More information needed", "Not indicated by these answers"].sort());
});
test("live v1 questionnaire rejects offline source-policy controls rather than accepting a candidate mode", () => {
  assert.equal(checkerFactsSchema.safeParse({
    ...factsFromProfile({}), sourceContext: { mode: "isolated_candidate_validation" },
  }).success, false);
});
test("altered authoritative privacy passage and NAFDAC PDF cannot reuse a source binding", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const read = (path: string) => readFileSync(`${root}/${path}`);
  assert.throws(() => bindRemainingSourceCandidates(now, path => {
    if (!path.endsWith("ndpa-captured-passages.json")) return read(path);
    const data = JSON.parse(read(path).toString("utf8"));
    data.passages[0].exactText += " altered";
    return Buffer.from(JSON.stringify(data));
  }), /privacy passage/u);
  assert.throws(() => bindRemainingSourceCandidates(now, path => {
    const bytes = read(path);
    if (path.endsWith("nafdac_cap_f33.pdf")) bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    return bytes;
  }), /NAFDAC PDF/u);
});
