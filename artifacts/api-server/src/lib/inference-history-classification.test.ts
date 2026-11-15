import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {emptyBudget,importPilotUsage,requestDigest} from "./inference-budget";
import {classifyHistoricalInference,applyHistoricalClassifications,verifiedPilotImports,
  type HistoryEvidence,type HistoryRow} from "./inference-history-classification";
const h=(s:string)=>createHash("sha256").update(s).digest("hex");
export function controlledHistory(){
  const row=(sourceKey:string,change:Partial<HistoryRow>={}):HistoryRow=>({sourceKey,lane:"editorial_evaluation",id:sourceKey.split(":")[1]!,
    role:"draft",model:"gpt-5-mini",responseId:null,input:null,output:null,status:"failed",failureCode:"PROVIDER_FAILURE",
    candidateHash:null,inputHash:null,pipelineId:"controlled-pipeline",...change});
  const rows=[
    row("publication:1",{lane:"publication",role:"factual",model:null,status:null,candidateHash:h("final")}),
    row("publication:2",{lane:"publication",model:null,status:null,candidateHash:h("original drafting prompt")}),
    row("editorial:failed"),
    row("editorial:held-f",{role:"factual",status:"dependency_held",failureCode:"DRAFT_NOT_READY"}),
    row("editorial:held-c",{role:"challenge",status:"dependency_held",failureCode:"DRAFT_NOT_READY"}),
    row("editorial:success",{model:"gpt-5.4-mini-2026-03-17",role:"factual",responseId:"controlled-editorial",
      status:"succeeded",input:10,output:20,inputHash:h("actual run input"),candidateHash:h("editorial candidate"),pipelineId:"success-pipeline"}),
    row("customer:one:0",{lane:"customer",model:"gpt-5.4-mini",role:"customer",responseId:"controlled-customer",input:100,output:50}),
  ];
  const artifact=(r:HistoryRow)=>{
    const bytes=Buffer.from(JSON.stringify({role:r.role,...(r.role==="draft"?{promptHash:r.candidateHash}:{candidateHash:r.candidateHash}),
      model:"gpt-5.4-mini-2026-03-17",providerResponseId:`controlled-${r.id}`,inputTokens:216,outputTokens:239}));
    return{ref:{id:randomUUID(),hash:h(bytes.toString()),extension:"json" as const},bytes,
      reportCandidateHash:r.candidateHash!,sourceReportSha256:h("retained-report")};
  };
  const e:HistoryEvidence={rows,publicationAttempts:rows.filter(r=>r.lane==="publication").map(r=>({id:r.id,role:r.role,
    candidateHash:r.candidateHash!,requestHash:null,responseId:null,inputTokens:null,outputTokens:null})),
    publicationArtifacts:rows.filter(r=>r.lane==="publication").map(artifact),
    editorialReceipts:[{sourceKey:"editorial:success",sourceReportSha256:h("report"),role:"factual",
      model:"gpt-5.4-mini-2026-03-17",responseId:"controlled-editorial",input:10,output:20,inputHash:h("actual run input")}],
    sourceReferences:[{path:"controlled-source",sha256:h("control source")}],excludedNoOutboundCustomerRuns:12};
  const state=importPilotUsage(emptyBudget(),rows.map(r=>({sourceKey:r.sourceKey,lane:r.lane,model:r.model,responseId:r.responseId,
    input:r.input,output:r.output}))).state;
  return{e,state};
}
test("matches drafting prompt separately; reconciles real receipt shape and exact held review IDs without removing old entries",()=>{
  const{e,state}=controlledHistory(),before=structuredClone(state),report=classifyHistoricalInference(state,e);
  const after=applyHistoricalClassifications(state,report);
  assert.equal(after.entries.length,7);assert.equal(after.historyResolutions!.length,7);
  assert.deepEqual(after.historyResolutions!.map(r=>r.before),before.entries);
  assert.equal(after.entries.filter(r=>r.status==="settled").length,4);
  assert.equal(after.entries.filter(r=>r.status==="cancelled").length,2);
  assert.equal(after.unboundedPrior.length,1);assert.equal(after.priorUseReconciled,false);
  const failed=after.entries.find(r=>r.runKey===`pilot:${requestDigest("editorial:failed")}`)!;
  assert.equal(failed.status,"unknown");assert.equal(failed.inputBound,0);assert.equal(failed.reserved,"0");
  assert.equal(report.excludedNoOutboundCustomerRuns,12);
  assert.deepEqual(state,before);
  assert.deepEqual(applyHistoricalClassifications(after,classifyHistoricalInference(after,e)),after);
});
test("future importer preserves actual model/usage and never double-subtracts excluded customer faults",()=>{
  const{e}=controlledHistory(),imports=verifiedPilotImports(e);
  assert.equal(imports.length,5);
  assert.equal(imports.filter(r=>r.sourceKey.startsWith("publication:")&&r.model==="gpt-5.4-mini-2026-03-17").length,2);
  const first=importPilotUsage(emptyBudget(),imports),again=importPilotUsage(first.state,imports);
  assert.equal(again.imported,0);assert.equal(again.state.entries.length,5);assert.equal(again.state.unboundedPrior.length,1);
});
test("missing/wrong historical drafting prompt or changed artifact bytes never discharges an unknown charge",()=>{
  for(const change of["wrong-prompt","bad-bytes"]){
    const{e,state}=controlledHistory(),a=e.publicationArtifacts[1]!;
    if(change==="wrong-prompt")a.reportCandidateHash=h("final, not drafting prompt");else a.bytes=Buffer.from("{}");
    const r=classifyHistoricalInference(state,e);
    assert.equal(r.classifications.find(c=>c.sourceKey==="publication:2")!.kind,"unresolved_charge");
  }
});
test("failed draft or partial metadata is never zero cost merely because dependent reviews did not run",()=>{
  for(const change of[{failureCode:"OTHER"},{responseId:"possibly-called"},{input:1},{pipelineId:"different"}]){
    const{e,state}=controlledHistory();Object.assign(e.rows[3]!,change);
    assert.equal(classifyHistoricalInference(state,e).classifications.find(c=>c.sourceKey==="editorial:held-f")!.kind,"unresolved_charge");
  }
});
test("hash-bound editorial reports must match actual run ID, role, input and response rather than aggregate totals",()=>{
  const{e,state}=controlledHistory();e.editorialReceipts[0]!.inputHash=h("wrong input");
  assert.throws(()=>classifyHistoricalInference(state,e),/EDITORIAL_RECEIPT_CONFLICT/);
});
test("changed source inventory, stale ledger, duplicate receipt and changed historical resolutions are rejected",()=>{
  const{e,state}=controlledHistory(),r=classifyHistoricalInference(state,e);
  const changed=structuredClone(state);changed.suspended=true;
  assert.throws(()=>applyHistoricalClassifications(changed,r),/STATE_CHANGED/);
  assert.throws(()=>classifyHistoricalInference(state,{...e,rows:e.rows.slice(1)}),/COVERAGE_INCOMPLETE/);
  assert.throws(()=>classifyHistoricalInference(state,{...e,rows:[...e.rows,e.rows[0]!]}),/DUPLICATE_SOURCE/);
  const after=applyHistoricalClassifications(state,r);e.publicationArtifacts[0]!.bytes=Buffer.from("{}");
  assert.throws(()=>classifyHistoricalInference(after,e),/PUBLICATION_RECEIPT_UNAVAILABLE/);
});
