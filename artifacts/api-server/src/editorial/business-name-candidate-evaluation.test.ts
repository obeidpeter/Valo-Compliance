import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateBusinessNameCandidate } from "@workspace/valo-core/checker-business-name";
import { bindBusinessNameCandidate } from "./business-name-candidate-binding";

const now = new Date("2026-11-14T23:00:00.000Z");
const bound = bindBusinessNameCandidate(now);
const cases = bound.corpus.cases.filter(c => c.sourceCandidateID === "CAND-CAMA-814-BUSINESS-NAME");
const evaluate = (facts: unknown) => evaluateBusinessNameCandidate(facts, "2026-11-13", bound.binding);
const first = cases[0]!;
test("actual retained CAMA corpus: rich facts and exact sources, isolated from customer release", async t => {
  assert.equal(cases.length, 20);
  for (const c of cases) await t.test(c.caseID, () => {
    const actual = evaluateBusinessNameCandidate(c.facts, c.assessmentDate, bound.binding);
    const expected = (c as typeof c & {
      expectedOutcomeCandidate: { customerLabelCandidate: string };
    }).expectedOutcomeCandidate.customerLabelCandidate;
    assert.equal(actual.label, expected);
    assert.equal(actual.eligibleForCustomerUse, false);
    assert.equal(actual.releasedManifestId, null);
    assert.equal(actual.createRegistrationTask, false);
    assert.equal(actual.automaticReminder, false);
    assert.equal(actual.automaticStatutoryDeadline, null);
    assert.deepEqual(actual, evaluateBusinessNameCandidate(c.facts, c.assessmentDate, bound.binding));
  });
});
test("required unknown, unanswered and not-applicable facts remain distinct and never become false", () => {
  for (const status of ["unknown", "unanswered", "not_applicable"] as const) {
    const actual = evaluate({ ...first.facts, hasPlaceOfBusinessInNigeria: { status, value: null } });
    assert.equal(actual.label, "More information needed");
    assert.deepEqual(actual.missingFacts, [{ field: "hasPlaceOfBusinessInNigeria", state: status }]);
  }
});
test("known false short-circuits an unrelated unknown without declaring general exemption", () => {
  const actual = evaluate({ ...first.facts, carryingOnBusiness: false,
    hasPlaceOfBusinessInNigeria: { status: "unknown", value: null } });
  assert.equal(actual.label, "Not indicated by these answers");
  assert.ok(actual.gaps.some(s => s.includes("not a general registration exemption")));
});
test("court exception labels without appointment facts do not establish an exception", () => {
  assert.equal(evaluate({ ...first.facts, section814Exception: "court_manager_confirmed" }).label,
    "More information needed");
});
test("surname-only base does not require immaterial forename or court-exception answers", () => {
  assert.equal(evaluate({ ...first.facts, businessName: "Afolabi", trueForenames: undefined,
    operatorRole: "manager", appointmentAuthority: { status: "unknown", value: null } }).label,
    "Not indicated by these answers");
});
test("corporate exact-name result skips inapplicable surname and unresolved immaterial exception", () => {
  const c = cases.find(c => c.caseID === "CHK-CAND-CAMA-008")!;
  const actual = evaluate({ ...c.facts, operatorRole: "manager",
    appointmentAuthority: { status: "unknown", value: null } });
  assert.equal(actual.label, "Not indicated by these answers");
  assert.deepEqual(actual.missingFacts, []);
});
test("shared surname plural cannot erase a different third partner", () => {
  const c = cases.find(c => c.caseID === "CHK-CAND-CAMA-012")!;
  const partners = [...c.facts.partners as { surname: string; forenames: string[] }[],
    { surname: "Bello", forenames: ["Amina"] }];
  const actual = evaluate({ ...c.facts, partners, namingAssessment: { onlyAdditionIsPluralS: true } });
  assert.equal(actual.label, "Likely relevant");
  assert.match(actual.reason, /partner positions 3/u);
});
test("mixed corporate partner is a scope question, not a fabricated surname", () => {
  const c = cases.find(c => c.caseID === "CHK-CAND-CAMA-005")!;
  assert.equal(evaluate({ ...c.facts, partners: [{ surname: "Okafor", forenames: ["Ife"] },
    { type: "corporation", corporateName: "Synthetic Company Limited" }] }).label,
  "More information needed");
});
test("future and historical contexts do not reuse present-day candidate eligibility", () => {
  for (const date of ["2019-12-31", "2030-01-01"])
    assert.equal(evaluateBusinessNameCandidate(first.facts, date, bound.binding).label, "More information needed");
});
test("registered exact-name record never becomes an automatic duplicate registration task", () => {
  const actual = evaluate({ ...first.facts, businessNameRegistered: true });
  assert.equal(actual.label, "Likely relevant");
  assert.equal(actual.createRegistrationTask, false);
  assert.equal(actual.candidateTaskSuggestion, null);
  assert.match(actual.registrationAction, /do not create a duplicate/u);
});
test("altered source bytes, missing passages and stale retrievals fail binding", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");
  assert.throws(() => bindBusinessNameCandidate(now, path =>
    read(path) + (path.endsWith("business-name-source-passages.json") ? " " : "")), /hash mismatch/u);
  assert.throws(() => bindBusinessNameCandidate(now, path =>
    path.endsWith("business-name-source-passages.json") ? '{"passages":[]}' : read(path)), /hash mismatch/u);
  assert.throws(() => bindBusinessNameCandidate(new Date("2027-01-01T00:00:00Z")), /stale/u);
});
