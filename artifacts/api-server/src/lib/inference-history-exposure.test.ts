import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {emptyBudget,importPilotUsage,requestDigest,tokenCost} from "./inference-budget";
import {proposeHistoricalReceiptResolutions,projectHistoricalExposure} from "./inference-history-reconciliation";
const hash=(s:Uint8Array)=>createHash("sha256").update(s).digest("hex");
function setup(){
  const state=importPilotUsage(emptyBudget(),[{sourceKey:"publication:1",lane:"publication",responseId:null,input:null,output:null,model:null},
    {sourceKey:"customer:other",lane:"customer",responseId:null,input:null,output:null,model:null}]).state;
  const row={id:"1",candidateHash:requestDigest("controlled-candidate"),role:"factual",requestHash:null,responseId:null,inputTokens:null,outputTokens:null};
  const bytes=Buffer.from(JSON.stringify({candidateHash:row.candidateHash,role:"factual",providerResponseId:"controlled-only",
    model:"gpt-5.4-mini",inputTokens:100,outputTokens:50}));
  const report=proposeHistoricalReceiptResolutions(state,[row],[{ref:{id:"8f50692a-cb57-4a0e-a363-e8be0a41bfb1",hash:hash(bytes),extension:"json"},
    bytes,reportCandidateHash:row.candidateHash,sourceReportSha256:requestDigest("controlled-source-report")}]);
  return{state,report};
}
test("verified retained receipts refine the projection but never mark potential charges as paid or mutate old entries",()=>{
  const{state,report}=setup(),before=requestDigest(state),p=projectHistoricalExposure(state,report);
  assert.equal(p.retainedReceiptRefinements,1);assert.equal(p.unresolvedLiabilities,1);
  assert.equal(p.projectedUsageEstimateNanoUsd,tokenCost(100,50).toString());
  assert.equal(p.inclusiveRemainingNanoUsd,null);assert.equal(p.actualBillingVerified,false);
  assert.equal(requestDigest(state),before);assert.equal(state.entries[0]!.status,"unknown");
});
test("exposure projection refuses stale history and changed receipt cost evidence",()=>{
  const{state,report}=setup();
  assert.throws(()=>projectHistoricalExposure({...state,suspended:true},report),/PROJECTION_CHANGED/);
  report.proposed[0]!.estimatedNanoUsd="0";
  assert.throws(()=>projectHistoricalExposure(state,report),/BINDING_CHANGED/);
});
test("missing evidence preserves every unbounded liability without a fictional maximum-model substitution",()=>{
  const{state}=setup(),report=proposeHistoricalReceiptResolutions(state,[],[]),p=projectHistoricalExposure(state,report);
  assert.equal(p.unresolvedLiabilities,2);assert.equal(p.modelCapacityAssumptionsApplied,0);
  assert.equal(p.inclusiveRemainingNanoUsd,null);
});
