import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {digest} from "@workspace/valo-core";
import {publicationWorkspaceRoot} from "./operational-policy";
import {readFrozenContentPackage,prepareFrozenContentDraft,extractNamedContentDraft,contentPreparationReadiness,
  frozenContentPackageId} from "./content-intake-preparation";

test("all 108 original identities construct canonical drafts without inventing review or runtime readiness",async()=>{
  const report=await contentPreparationReadiness();
  assert.equal(report.packageId,frozenContentPackageId);
  assert.deepEqual(report.totals,{frozenUnits:108,canonicalDrafts:108,implementedReviewPreparers:17,
    incompleteReviewPreparers:91,intakeFailures:0});
  assert.equal(new Set(report.outcomes.map(x=>x.identity)).size,108);
  for(const row of report.outcomes){
    assert.equal(row.publicationEligible,false);assert.equal(row.nativeReadiness,"not_queried");
    assert.ok(typeof row.canonicalDocumentHash==="string"&&/^[a-f0-9]{64}$/.test(row.canonicalDocumentHash));
    if(row.preparationStatus==="review_preparer_engineering_incomplete"){
      assert.ok(Array.isArray(row.engineeringGaps)&&row.engineeringGaps.length>0);
      assert.equal(row.runtimeReviewPreparer,null);
    }
  }
  assert.equal(report.providerCalls,0);assert.equal(report.approvalRowsWritten,0);assert.equal(report.publicationActions,0);
});
test("named guide and industry bodies retain source prose but exclude internal status and source leads",async()=>{
  const pkg=await readFrozenContentPackage(),root=publicationWorkspaceRoot();
  for(const section of pkg.namedContentSections){
    const prepared=await prepareFrozenContentDraft(section.identity,pkg);
    assert.equal(prepared.identity,section.identity);assert.equal(prepared.documentHash,digest(prepared.document));
    assert.equal(prepared.reviewRequestsCreated,0);assert.equal(prepared.currentDraftStatus,"constructed_unreviewed");
    assert.doesNotMatch(JSON.stringify(prepared.document),/DRAFT —|EDP-\d|Candidate source leads:|Template connections:/);
    const source=await readFile(resolve(root,section.sourcePath),"utf8");
    assert.throws(()=>extractNamedContentDraft({...section,baselineSectionSha256:"f".repeat(64)},source),/SECTION_CHANGED/);
  }
  const guide=pkg.namedContentSections.find(s=>s.heading.startsWith("GUIDE-C01"))!;
  const prepared=await prepareFrozenContentDraft(guide.identity,pkg);
  assert.match(JSON.stringify(prepared.document),/fictional sale of three notebooks/);
  assert.match(JSON.stringify(prepared.document),/This example does not specify a tax treatment/);
});
test("draft preparation rejects unlisted identities, forged packages and ambiguous headings",async()=>{
  const pkg=await readFrozenContentPackage();
  await assert.rejects(()=>prepareFrozenContentDraft("TPL-41",pkg),/OUTSIDE_FROZEN/);
  const forged=structuredClone(pkg);forged.contentIds.push("TPL-41");
  await assert.rejects(()=>prepareFrozenContentDraft("TPL-01",forged),/PACKAGE_CHANGED/);
  const section=pkg.namedContentSections[0]!,source=await readFile(resolve(publicationWorkspaceRoot(),section.sourcePath),"utf8");
  assert.throws(()=>extractNamedContentDraft(section,source+`\n## ${section.heading}\nDuplicate\n`),/NOT_UNIQUE/);
});
