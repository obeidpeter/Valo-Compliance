import test from "node:test";
import assert from "node:assert/strict";
import {candidateDigest,digest,disclosure,sha256,type PublicationBundle} from "@workspace/valo-core";
import {reviewedBaselineEvidence,publicationHoldTransition,verifyCurrentEditorialDenials,editorialDeniedActions,
  editorialDenialReason,type EditorialDenialReceipt,type EditorialDenialAuditRow} from "./editorial-evaluation-evidence";

const hash="a".repeat(64),versionId="55555555-5555-4555-8555-555555555555";
function baseline(){
  // Deliberately held synthetic data; this fixture is never a publication pass
  // and does not stand in for retained provider receipts or native DB proof.
  const b:PublicationBundle={candidate:{id:"CONTROLLED",version:5,body:"Synthetic provenance control only",hash,
    contentClass:"general_template",jurisdiction:"NG",risk:"general",scope:"Test only",limitations:"Not released",
    assumptions:[],unresolvedMaterialIssues:["Controlled unrelated hold"],missingEvidence:[],sourceCheckDate:"2026-01-01T00:00:00Z",
    disclosure,evidenceMode:"original_operational",legalScopeStatus:"not_applicable",reviewBy:"2099-01-01T00:00:00Z",claims:[]},
    sources:[],rights:{status:"unknown",evidence:"Controlled hold",evidenceHash:hash,commercialUse:false},
    policy:{version:"controlled",hash,ownerApproved:false,allowedClasses:[],jurisdictions:[],risks:[],officialHosts:["example.invalid"],blockedActivities:[]},
    draftRun:{runId:"controlled-draft",model:"controlled",promptVersion:"test",candidateHash:hash,evidenceHash:digest([])},
    reviews:[],enhancedChecks:[],mechanicalChecks:[],exports:[],
    manifest:{candidateHash:hash,evidenceHash:hash,rightsHash:hash,policyHash:hash,reviewHash:hash,checksHash:hash,exportsHash:hash,status:"review"}};
  b.candidate.hash=candidateDigest(b.candidate);b.draftRun.candidateHash=b.candidate.hash;
  b.reviews=(["factual","challenge"] as const).map(role=>({...b.draftRun,role,runId:`controlled-${role}`,
    verdict:"hold",findings:["Controlled unrelated finding"],receivedOtherVerdict:false}));
  return b;
}
function fixture(){
  const bundle=baseline(),ref=(id:string)=>({id,hash,extension:"json" as const});
  const attestations={reviews:[ref("review-factual"),ref("review-challenge")],provenance:ref("provenance"),rights:ref("rights"),exportReport:ref("exports")};
  const retained={id:versionId,version:5,candidateHash:bundle.candidate.hash,bundle,attestations};
  const summary={id:versionId,version:5,candidateHash:bundle.candidate.hash,attestations,
    reviews:bundle.reviews.map(r=>({role:r.role,providerResponseId:r.runId,model:r.model,verdict:r.verdict,findings:r.findings}))};
  return{retained,summary,bytes:Buffer.from(JSON.stringify(summary)),path:"docs/valo/evidence/operational-publication-v5.json"};
}
test("selected v5 baseline retains its own ID, unmutated hash, eligibility and exact source/receipt bindings",()=>{
  const f=fixture(),latest={id:"88888888-8888-4888-8888-888888888888",bundle:{unrelated:"v8"}};
  const result=reviewedBaselineEvidence(f.retained,f.bytes,f.path),before=digest(result.bundle);
  assert.equal(result.evidence.baselineId,versionId);assert.notEqual(result.evidence.baselineId,latest.id);
  assert.equal(result.evidence.baselineVersion,5);assert.equal(result.evidence.baselineBundleHash,digest(f.retained.bundle));
  assert.notEqual(result.evidence.baselineBundleHash,digest(latest.bundle));assert.equal(result.evidence.originalBaselineEligible,false);
  assert.equal(result.evidence.reviewEvidenceHash,sha256(f.bytes));assert.equal(result.evidence.reviewEvidencePath,f.path);
  assert.deepEqual(result.evidence.reviewArtifacts,f.retained.attestations.reviews);
  for(const [target,mutate]of [
    [/review_not_blind/,(b:PublicationBundle)=>{b.reviews[0]!.receivedOtherVerdict=true;}],
    [/runs_not_separate/,(b:PublicationBundle)=>{b.reviews[0]!.runId=b.draftRun.runId;}],
  ]as const){
    const evidence=publicationHoldTransition(result.bundle,mutate,target);
    assert.equal(evidence.baselineBundleHash,before);assert.notEqual(evidence.bundleHash,before);
    assert.equal(evidence.originalBaselineEligible,false);assert.ok(evidence.targetReasons.length);
    assert.ok(!evidence.baselineReasons.some(r=>target.test(r)));assert.equal(digest(result.bundle),before);
  }
});
test("wrong row, summary version/hash or substituted artifact/provider identity fails baseline binding",()=>{
  const changes=[
    (f:ReturnType<typeof fixture>)=>{f.retained.id="88888888-8888-4888-8888-888888888888";},
    (f:ReturnType<typeof fixture>)=>{f.summary.version=8;},
    (f:ReturnType<typeof fixture>)=>{f.summary.candidateHash="b".repeat(64);},
    (f:ReturnType<typeof fixture>)=>{f.summary.attestations=structuredClone(f.summary.attestations);f.summary.attestations.reviews[0]!.hash="b".repeat(64);},
    (f:ReturnType<typeof fixture>)=>{f.summary.reviews[0]!.providerResponseId="substituted-run";},
    (f:ReturnType<typeof fixture>)=>{f.summary.reviews[0]!.model="substituted-model";},
    (f:ReturnType<typeof fixture>)=>{f.summary.reviews[0]!.verdict="pass";},
  ];
  for(const change of changes){const f=fixture();change(f);
    assert.throws(()=>reviewedBaselineEvidence(f.retained,Buffer.from(JSON.stringify(f.summary)),f.path),/REVIEW_BASELINE_/);}
});
test("already contaminated or reused-run baselines cannot be counted as newly demonstrated controls",()=>{
  const contaminated=baseline();contaminated.reviews[0]!.receivedOtherVerdict=true;
  assert.throws(()=>publicationHoldTransition(contaminated,b=>{b.reviews[0]!.receivedOtherVerdict=true;},/review_not_blind/),/ALREADY_PRESENT/);
  const duplicate=baseline();duplicate.reviews[0]!.runId=duplicate.draftRun.runId;
  assert.throws(()=>publicationHoldTransition(duplicate,b=>{b.reviews[0]!.runId=b.draftRun.runId;},/runs_not_separate/),/ALREADY_PRESENT/);
  assert.throws(()=>publicationHoldTransition(baseline(),()=>{},/runs_not_separate/),/NOT_INTRODUCED/);
});
function denialRun(runId:string){
  const receipts:EditorialDenialReceipt[]=editorialDeniedActions.map((requestedAction,i)=>({auditId:`${runId}-${i}`,
    versionId,requestedAction,evaluationRunId:runId}));
  const rows:EditorialDenialAuditRow[]=receipts.map(r=>({id:r.auditId,version_id:versionId,action:"external_action_denied",
    actor:"bounded-publisher",reason:editorialDenialReason(r.requestedAction,runId)}));
  return{receipts,rows};
}
test("two runs prove their own three action-specific IDs and cannot borrow prior rows",()=>{
  const first=denialRun("first-controlled-run"),second=denialRun("second-controlled-run");
  assert.deepEqual(verifyCurrentEditorialDenials(versionId,"first-controlled-run",first.receipts,first.rows),first.receipts);
  assert.deepEqual(verifyCurrentEditorialDenials(versionId,"second-controlled-run",second.receipts,second.rows),second.receipts);
  assert.throws(()=>verifyCurrentEditorialDenials(versionId,"second-controlled-run",second.receipts,first.rows),/ROW_MISSING/);
  assert.throws(()=>verifyCurrentEditorialDenials(versionId,"second-controlled-run",first.receipts,first.rows),/RUN_MISMATCH/);
});
test("missing, duplicate, wrong-action/version/actor and stale-run denials cannot satisfy C054",()=>{
  const changes:[(x:ReturnType<typeof denialRun>)=>void,RegExp][]=[
    [x=>{x.rows.pop();},/ROWS_INCOMPLETE/],
    [x=>{x.receipts[1]!.auditId=x.receipts[0]!.auditId;},/IDS_NOT_DISTINCT/],
    [x=>{x.rows[1]!.id=x.rows[0]!.id;},/ROWS_NOT_DISTINCT/],
    [x=>{x.receipts[1]!.requestedAction="price";},/ACTION_MISMATCH/],
    [x=>{x.rows[0]!.version_id="different-version";},/VERSION_MISMATCH/],
    [x=>{x.rows[0]!.actor="wrong-role";},/ACTOR_MISMATCH/],
    [x=>{x.rows[0]!.reason=editorialDenialReason("government_filing","current-run");},/REASON_MISMATCH/],
    [x=>{x.rows[0]!.reason=editorialDenialReason("price","old-run");},/REASON_MISMATCH/],
  ];
  for(const [change,error]of changes){const x=denialRun("current-run");change(x);
    assert.throws(()=>verifyCurrentEditorialDenials(versionId,"current-run",x.receipts,x.rows),error);}
});
