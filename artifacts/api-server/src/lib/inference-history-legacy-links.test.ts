import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {emptyBudget,importPilotUsage} from "./inference-budget";
import {proposeHistoricalReceiptResolutions} from "./inference-history-reconciliation";
const candidateHash="a".repeat(64),requestHash="b".repeat(64);
function evidence(){
  const source={id:"81",candidateHash,role:"factual",requestHash,responseId:null,inputTokens:null,outputTokens:null};
  const bytes=Buffer.from(JSON.stringify({candidateHash,role:"factual",requestHash,
    providerResponseId:"controlled-retained-response",model:"gpt-5.4-mini-2026-03-17",inputTokens:21,outputTokens:7}));
  const artifact={ref:{id:"11111111-1111-4111-8111-111111111111",extension:"json" as const,
    hash:createHash("sha256").update(bytes).digest("hex")},bytes,reportCandidateHash:candidateHash,sourceReportSha256:"c".repeat(64)};
  const state=importPilotUsage(emptyBudget(),[{sourceKey:"publication:81",lane:"publication",
    model:null,responseId:null,input:null,output:null}]).state;
  return{source,artifact,state};
}
test("old reservation without response ID joins actual candidate, role, request and hash-verified retained receipt",()=>{
  const e=evidence(),r=proposeHistoricalReceiptResolutions(e.state,[e.source],[e.artifact,e.artifact]);
  assert.equal(r.proposed.length,1);assert.equal(r.proposed[0]!.receipt.responseId,"controlled-retained-response");
  assert.equal(r.proposed[0]!.receipt.inputTokens,21);
  assert.equal(e.source.responseId,null);assert.equal(e.state.entries[0]!.status,"unknown");
});
test("ambiguous matching attempts or conflicting request evidence never guess or zero a historical charge",()=>{
  const e=evidence();
  assert.equal(proposeHistoricalReceiptResolutions(e.state,[e.source,{...e.source,id:"82"}],[e.artifact]).proposed.length,0);
  const mismatch=proposeHistoricalReceiptResolutions(e.state,[{...e.source,requestHash:"d".repeat(64)}],[e.artifact]);
  assert.equal(mismatch.proposed.length,0);assert.equal(mismatch.unresolved.length,1);
  assert.ok(e.state.unboundedPrior.length>0);
});
