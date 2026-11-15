import test from "node:test";
import assert from "node:assert/strict";
import {prepareFiniteAllocationPackage,allocationPackageId,validateAllocationPackage,assertWorkPackageMembership} from "./inference-allocation-package";
import {additionalInferenceAllocation,requestDigest} from "./inference-budget";
import type {FiniteWork} from "./inference-batch-dispatch";
import {readFile} from "node:fs/promises";
const work=():FiniteWork=>({key:"controlled-factual",lane:"publication",role:"factual",pair:"controlled-pair",
  candidateHash:"a".repeat(64),caseHash:"b".repeat(64),sourceHashes:[],
  request:{model:"gpt-5.4-mini",max_completion_tokens:8192,messages:[{role:"user",content:"controlled review"}]},
  bindings:{candidateVersionId:"11111111-1111-4111-8111-111111111111",corpus:null,caseId:null,sourceFiles:[],
    operationalPlan:{id:"22222222-2222-4222-8222-222222222222",hash:"c".repeat(64),extension:"json"}}});
test("package freezes actual inventory and the original three case rosters without approving them",async()=>{
  const pkg=await prepareFiniteAllocationPackage();validateAllocationPackage(pkg);
  assert.ok(pkg.contentIds.includes("TPL-07"));assert.deepEqual(pkg.corpora.map(c=>c.cases.length),[60,80,60]);
  assert.equal(pkg.contentIds.length+pkg.namedContentSections.length,108);assert.equal(pkg.namedContentSections.length,38);
  assert.deepEqual(pkg.allocation,additionalInferenceAllocation);assert.equal(pkg.sourceFiles.length,7);
  assert.equal(allocationPackageId(pkg),`finite-package:${requestDigest(pkg)}`);
  assert.deepEqual(pkg.supportedPreparers,["operational-template-pair-v1"]);
  assert.equal("approved" in pkg,false);
});
test("delegated membership cannot broaden the content inventory or enable unsupported preparers",async()=>{
  const pkg=await prepareFiniteAllocationPackage(),w=work();
  assert.doesNotThrow(()=>assertWorkPackageMembership(w,pkg,"TPL-07"));
  assert.throws(()=>assertWorkPackageMembership(w,pkg,"unapproved-content"),/OUTSIDE_PACKAGE/);
  for(const id of ["TPL-01","TPL-06","TPL-09","TPL-11","TPL-12","TPL-22","TPL-24","TPL-34","TPL-35","TPL-38"])
    assert.doesNotThrow(()=>assertWorkPackageMembership(w,pkg,id));
  for(const id of ["TPL-13","TPL-39","TPL-40","GUD-01"])assert.throws(()=>assertWorkPackageMembership(w,pkg,id),/PREPARER_UNAVAILABLE/);
  const customer={...w,lane:"customer" as const,role:"customer" as const,pair:null,
    caseHash:pkg.corpora.find(c=>c.name==="customer-ai")!.cases[0]!.hash,
    bindings:{...w.bindings,corpus:"customer-ai" as const,caseId:pkg.corpora.find(c=>c.name==="customer-ai")!.cases[0]!.id}};
  assert.throws(()=>assertWorkPackageMembership(customer,pkg,null),/PREPARER_UNAVAILABLE/);
  customer.caseHash="f".repeat(64);assert.throws(()=>assertWorkPackageMembership(customer,pkg,null),/OUTSIDE_PACKAGE/);
});
test("package allocation, lane ceilings and allowed roles are immutable policy decisions",async()=>{
  for(const edit of[(p:any)=>{p.allocation.id="new-counter";},(p:any)=>{p.allocation.capNanoUsd="60000000000";},
    (p:any)=>{p.laneAttemptLimits.publication=999;},(p:any)=>{p.allowedRoles.push("draft");},
    (p:any)=>{p.sourceFiles[0].path="../secret";}]){
    const pkg=await prepareFiniteAllocationPackage();edit(pkg);assert.throws(()=>validateAllocationPackage(pkg),/INVALID/);
  }
});
test("frozen disabled owner-review artifact matches exact repository bytes, cases and named sections",async()=>{
  const frozen=JSON.parse(await readFile(new URL("../../../../docs/valo/evidence/finite-allocation-package-disabled.json",import.meta.url),"utf8"));
  assert.equal(frozen.status,"DISABLED_PROPOSAL_ONLY");assert.equal(frozen.ownerApproved,false);assert.equal(frozen.enabled,false);
  assert.equal(frozen.approvalRowsWritten,0);assert.equal(frozen.providerCalls,0);
  validateAllocationPackage(frozen.package);
  assert.equal(frozen.packageHash,requestDigest(frozen.package));assert.equal(frozen.packageId,allocationPackageId(frozen.package));
  assert.equal(frozen.packageId,"finite-package:3f21b47b43700024af042fa1284ed45503115a1f56dba2bd591d727a68df96a8");
  // Runtime preparation can improve inside these same frozen identities without
  // replacing the package, clearing its holds or authorising a provider call.
  for(const id of ["TPL-12","TPL-22","TPL-24","TPL-34","TPL-35","TPL-38"])
    assert.doesNotThrow(()=>assertWorkPackageMembership(work(),frozen.package,id));
  const actual=await prepareFiniteAllocationPackage(new Date(frozen.package.preparedAt));
  // In particular, do not normalize/trim JSON or Markdown before file hashing.
  // Object-equivalent corpus data with a changed newline still changes its pin.
  assert.deepEqual(frozen.package.sourceFiles,actual.sourceFiles);
  assert.deepEqual(frozen.package.corpora,actual.corpora);
  assert.deepEqual(frozen.package.contentIds,actual.contentIds);
  assert.deepEqual(frozen.package.namedContentSections,actual.namedContentSections);
});
