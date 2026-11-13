import assert from "node:assert/strict";
import { test } from "node:test";
import {
  additionalCandidates, baselineTemplates, catalogueSummary, readiness,
  requirements, requirementStatus, sha256,
  contentReadiness,
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
  assert.equal(r.receivedFormalRequirements, 127);
  assert.equal(r.missingFormalRequirements, 0);
  assert.deepEqual(requirements.filter(r => r.id.startsWith("EDP-")).map(r => r.id),
    Array.from({ length: 12 }, (_, i) => `EDP-${String(i + 1).padStart(3, "0")}`));
  assert.equal(new Set(requirements.map(r => r.id)).size, 127);
  for (const [family, count] of [["WEB",4],["IAM",3],["PRO",3],["DOC",9],["EDT",10],["AI",9],["CMP",9],["RUL",9],["WRK",6],["SRV",4],["PAY",10],["ADM",9],["OPS",8],["SEC",8],["PRV",3],["NFR",11]] as const) {
    assert.deepEqual(requirements.filter(r => r.id.startsWith(`${family}-`)).map(r => r.id),
      Array.from({ length: count }, (_, i) => `${family}-${String(i + 1).padStart(3, "0")}`));
  }
  assert.ok(requirements.every(r => r.acceptance && r.exactText && r.sourceExactText?.includes(r.exactText) && r.sourceExactText.includes(r.acceptance)));
  assert.equal(requirements.filter(r => r.priority === "Must").length, 116);
  assert.equal(requirements.filter(r => r.priority === "Acceptance target").length, 11);
  assert.equal(requirements.find(r => r.id === "SRV-004")!.release, "R2/R3");
  assert.ok(requirements.find(r => r.id === "EDT-006")!.acceptance.includes("[S22–S23]"));
});
test("27 mappings, 79 held source rows and the SCUML alias remain distinct from publication", () => {
  const r = contentReadiness();
  assert.equal(r.supplementaryMappings.length, 27);
  assert.equal(r.supplementaryMappings.filter(m => m.mapping_type === "exact").length, 5);
  assert.equal(r.supplementaryMappings.filter(m => m.mapping_type === "composite").length, 1);
  assert.equal(r.identifiedAdditions.length, 21);
  assert.equal(r.regulatoryRows.length, 79);
  assert.equal(new Set(r.regulatoryRows.map(row => row.canonical_topic_id)).size, 78);
  assert.ok(r.regulatoryRows.every(row => row.publication_status === "held" && !row.mandatory_for_all_businesses));
  assert.equal(r.regulatoryRows.find(row => row.source_id === "REG-G01")!.canonical_topic_id, "REG-D01");
  assert.equal(r.summary.identifiedIncludingProposals, 80);
  assert.equal(r.industryTaxonomy.length, 20);
  assert.equal(r.deeperPacks.length, 6);
  assert.ok(r.furtherProposals.every(p => !p.countsAsPublished));
  assert.equal(new Set([...baselineTemplates, ...r.identifiedAdditions, ...r.furtherProposals].map(i => i.title.toLowerCase())).size, 80);
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
