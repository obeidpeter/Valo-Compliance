import test from "node:test";
import assert from "node:assert/strict";
import { coordinatingRefinement, allSourceLeads, finalSourceContext } from "@workspace/valo-core";
test("coordinating mappings and resolutions do not become implementation or content approval", () => {
  const r = coordinatingRefinement;
  assert.equal(r.mappings.length, 27);
  assert.equal(r.conflicts.length, 13);
  assert.equal(r.sourceFindings.length, 14);
  assert.equal(r.summary.exactMatches, 5);
  assert.equal(r.summary.compositeManuals, 1);
  assert.equal(r.summary.distinctSupplementary, 21);
  assert.ok(r.mappings.every((m) => m.publication === "held" && !m.implementationAccepted));
  assert.ok(
    r.sourceFindings.every((s) => s.observationOwner === "coordinating_team" && !s.localValidationAccepted),
  );
  assert.equal(r.repositoryCorrection.creationClaimAccepted, false);
  assert.equal(r.repositoryCorrection.remoteSourceSyncConfirmed, false);
});
test("additional source leads deduplicate URLs without changing the 24 original IDs", () => {
  assert.equal(finalSourceContext.references.length, 24);
  // 24 original, four supplementary, three for the business-name rule, two for the tax guides, eight
  // for the food guides' guidelines, one employment Act, one consumer-protection Gazette and two
  // manual guide sources from the Joint Revenue Board and the issuing Labour Ministry.
  assert.equal(allSourceLeads.length, 45);
  assert.equal(new Set(allSourceLeads.map((s) => s.url)).size, 45);
  assert.equal(new Set(allSourceLeads.map((s) => s.id)).size, 45);
  assert.equal(
    allSourceLeads.find((s) => s.id === "JRB-TAXID-HOW")?.url,
    "https://taxid.jrb.gov.ng/how-it-works",
  );
  assert.equal(
    allSourceLeads.find((s) => s.id === "NELEX-LABOUR-ACT")?.url,
    "https://nelex.gov.ng/documents/LABOUR_ACT.pdf",
  );
  assert.equal(
    allSourceLeads.find((s) => s.id === "FCCPC-GAZETTE-2018")?.url,
    "https://fccpc.gov.ng/wp-content/uploads/2022/07/FCCPA-2018.pdf",
  );
  for (const id of ["CAC-BN-PROCESS", "NIPC-BFA-2022", "NCC-COPYRIGHT", "NASS-NTAA-2025", "NRS-TAXID-HOW"])
    assert.equal(allSourceLeads.filter((s) => s.id === id).length, 1);
  // Every lead is an https address.
  assert.ok(allSourceLeads.every((s) => new URL(s.url).protocol === "https:"));
  assert.equal(
    allSourceLeads.find((s) => s.id === "SV-010")?.url,
    "https://icrp.cac.gov.ng/assets/docs/CAMA-NOTE%20FINAL-FULL-VERSION.pdf",
  );
});
