import assert from "node:assert/strict";
import { test } from "node:test";
import {
  additionalCandidates, baselineTemplates, catalogueSummary, readiness,
  requirements, requirementStatus, sha256,
} from "@workspace/valo-core";

test("baseline preserves all 40 original identifiers and exact capability counts", () => {
  assert.equal(baselineTemplates.length, 40);
  assert.equal(new Set(baselineTemplates.map(t => t.id)).size, 40);
  assert.equal(baselineTemplates.filter(t => t.access === "free").length, 12);
  assert.equal(baselineTemplates.filter(t => t.access === "premium").length, 28);
  assert.equal(baselineTemplates.filter(t => t.guided).length, 12);
  assert.deepEqual(baselineTemplates.filter(t => t.customerAi).map(t => t.id),
    ["TPL-01", "TPL-02", "TPL-12", "TPL-22"]);
  assert.equal(baselineTemplates.find(t => t.id === "TPL-22")!.guided, false);
});
test("inventory metadata never counts as published content", () => {
  assert.ok(baselineTemplates.every(t => t.status === "held" && t.publishedVersion === null));
  assert.equal(catalogueSummary.published, 0);
  assert.equal(catalogueSummary.finalDistinctTotal, null);
  assert.equal(additionalCandidates.length, 19);
  assert.ok(additionalCandidates.every(t => !t.countsAsPublished));
});
test("missing formal requirements remain explicit and uninvented", () => {
  const r = readiness();
  assert.equal(r.expectedFormalRequirements, 127);
  assert.equal(r.receivedFormalRequirements, 12);
  assert.equal(r.missingFormalRequirements, 115);
  assert.deepEqual(requirements.map(r => r.id),
    Array.from({ length: 12 }, (_, i) => `EDP-${String(i + 1).padStart(3, "0")}`));
});
test("implementation path alone never verifies a requirement", () => {
  assert.equal(requirementStatus({ ...requirements[0], blockers: [] }), "in_progress");
});
test("passing test alone never verifies a requirement", () => {
  assert.equal(requirementStatus({
    ...requirements[0], blockers: [],
    evidence: [{ kind: "test", result: "pass", path: "synthetic", hash: sha256("synthetic") }],
  }), "in_progress");
});
test("a blocked gate cannot be accepted even with passing evidence", () => {
  const evidence = (["implementation", "test"] as const).map(kind => ({
    kind, result: "pass" as const, path: "synthetic", hash: sha256("synthetic"),
  }));
  assert.equal(requirementStatus({ ...requirements[0], evidence }), "blocked");
  assert.equal(requirementStatus({ ...requirements[0], evidence, blockers: [] }), "verified");
  assert.equal(requirementStatus({
    ...requirements[0], blockers: [],
    evidence: evidence.map(e => ({ ...e, hash: "" })),
  }), "in_progress");
});
test("R2, launch, live commerce and real confidential data remain disabled", () => {
  const r = readiness();
  assert.equal(r.r1Accepted, false);
  assert.equal(r.r2Unlocked, false);
  assert.equal(r.r3Excluded, true);
  assert.equal(r.publicLaunchEnabled, false);
  assert.equal(r.livePaymentsEnabled, false);
  assert.equal(r.recurringBillingEnabled, false);
  assert.equal(r.confidentialCustomerDataEnabled, false);
  assert.ok(r.suites.every(s => s.executedCases === 0 && !s.accepted));
  assert.ok(r.gates.every(g => g.status !== "passed"));
});
