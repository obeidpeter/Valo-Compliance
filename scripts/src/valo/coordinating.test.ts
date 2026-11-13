import test from "node:test";
import assert from "node:assert/strict";
import { coordinatingRefinement,allSourceLeads,finalSourceContext } from "@workspace/valo-core";
test("coordinating mappings and resolutions do not become implementation or content approval",()=>{
  const r=coordinatingRefinement;
  assert.equal(r.mappings.length,27);assert.equal(r.conflicts.length,13);assert.equal(r.sourceFindings.length,14);
  assert.equal(r.summary.exactMatches,5);assert.equal(r.summary.compositeManuals,1);
  assert.equal(r.summary.distinctSupplementary,21);
  assert.ok(r.mappings.every(m=>m.publication==="held"&&!m.implementationAccepted));
  assert.ok(r.sourceFindings.every(s=>s.observationOwner==="coordinating_team"&&!s.localValidationAccepted));
  assert.equal(r.repositoryCorrection.creationClaimAccepted,false);
  assert.equal(r.repositoryCorrection.remoteSourceSyncConfirmed,false);
});
test("additional source leads deduplicate URLs without changing the 24 original IDs",()=>{
  assert.equal(finalSourceContext.references.length,24);assert.equal(allSourceLeads.length,28);
  assert.equal(new Set(allSourceLeads.map(s=>s.url)).size,28);
  assert.equal(allSourceLeads.find(s=>s.id==="SV-010")?.url,"https://icrp.cac.gov.ng/assets/docs/CAMA-NOTE%20FINAL-FULL-VERSION.pdf");
});
