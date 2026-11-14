import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {emptyBudget,importPilotUsage,requestDigest} from "./inference-budget";
import {proposeHistoricalReceiptResolutions,verifyHistoricalPublicationReceipt,
  type HistoricalArtifactInput,type HistoricalPublicationAttempt} from "./inference-history-reconciliation";

const candidate="a".repeat(64),request="b".repeat(64);
function source(id="1"):HistoricalPublicationAttempt{return{id,candidateHash:candidate,role:"factual",requestHash:request,
  responseId:null,inputTokens:null,outputTokens:null};}
function artifact(overrides:Record<string,unknown>={},id="11111111-1111-4111-8111-111111111111"):HistoricalArtifactInput{
  const bytes=Buffer.from(JSON.stringify({candidateHash:candidate,role:"factual",requestHash:request,
    providerResponseId:"retained-response-1",model:"gpt-5.4-mini-2026-03-17",inputTokens:1234,outputTokens:87,...overrides}));
  return{bytes,ref:{id,hash:createHash("sha256").update(bytes).digest("hex"),extension:"json"},
    reportCandidateHash:candidate,sourceReportSha256:"c".repeat(64)};
}
function state(ids=["1"]){return importPilotUsage(emptyBudget(),ids.map(id=>({sourceKey:`publication:${id}`,
  lane:"publication" as const,responseId:null,input:null,output:null,model:null}))).state;}

test("proposes one exact retained receipt with auditable old state and leaves every liability untouched",()=>{
  const before=state(),hash=requestDigest(before),row=source(),a=artifact();
  const report=proposeHistoricalReceiptResolutions(before,[row],[a]);
  assert.equal(report.proposed.length,1);assert.equal(report.proposed[0]!.sourceKey,"publication:1");
  assert.equal(report.proposed[0]!.beforeEntryHash,requestDigest(before.entries[0]));
  assert.equal(report.proposed[0]!.sourceRowHash,requestDigest(row));
  assert.equal(report.proposed[0]!.receipt.artifactHash,a.ref.hash);
  assert.deepEqual(report.proposed[0]!.joinKeys,["candidateHash","role","requestHash"]);
  assert.equal(report.proposed[0]!.receipt.inputTokens,1234);
  assert.equal(report.proposed[0]!.receipt.outputTokens,87);
  assert.equal(report.ledgerWrites,0);assert.equal(report.reconciliationApplied,false);
  assert.equal(requestDigest(before),hash);assert.equal(before.entries[0]!.status,"unknown");
  assert.equal(before.unboundedPrior.length,1);assert.equal(before.priorUseReconciled,false);
});

test("mutated actual artifact bytes are held even if summary and reference claim a receipt",()=>{
  const a=artifact();a.bytes=Buffer.from(JSON.stringify({providerResponseId:"looks-real",inputTokens:0,outputTokens:0}));
  const report=proposeHistoricalReceiptResolutions(state(),[source()],[a]);
  assert.equal(report.proposed.length,0);assert.match(report.invalidArtifacts[0]!.reason,/HASH_INVALID/);
});

test("exact approved returned model and actual valid usage are required",()=>{
  for(const change of[{model:"gpt-5.4-mini-other"},{inputTokens:null},{outputTokens:-1},{outputTokens:1.5},
    {providerResponseId:""},{candidateHash:"d".repeat(64)}])
    assert.throws(()=>verifyHistoricalPublicationReceipt(artifact(change)),/FIELDS_INVALID/);
  assert.equal(verifyHistoricalPublicationReceipt(artifact({model:"gpt-5.4-mini",inputTokens:0,outputTokens:0})).inputTokens,0);
});

test("legacy missing request hash requires an unambiguous candidate and role, never row order",()=>{
  const a=artifact({requestHash:undefined}),one=proposeHistoricalReceiptResolutions(state(),[source()],[a]);
  assert.equal(one.proposed.length,1);assert.deepEqual(one.proposed[0]!.joinKeys,["candidateHash","role"]);
  for(const rows of[[source("1"),source("2")],[source("2"),source("1")]]){
    const report=proposeHistoricalReceiptResolutions(state(["1","2"]),rows,[a]);
    assert.equal(report.proposed.length,0);assert.equal(report.unresolved.length,2);
    assert.ok(report.unresolved.every(r=>r.reason==="HISTORY_ATTEMPT_AMBIGUOUS"));
  }
});

test("request hash disambiguates repeated candidate-role attempts only when it actually matches",()=>{
  const other={...source("2"),requestHash:"d".repeat(64)};
  const report=proposeHistoricalReceiptResolutions(state(["1","2"]),[other,source()],[artifact()]);
  assert.equal(report.proposed.length,1);assert.equal(report.proposed[0]!.sourceKey,"publication:1");
  assert.equal(report.unresolved[0]!.sourceKey,"publication:2");
});

test("conflicting historical usage or provider identity is never overwritten",()=>{
  const usage=proposeHistoricalReceiptResolutions(state(),[{...source(),inputTokens:99}],[artifact()]);
  assert.equal(usage.proposed.length,0);assert.equal(usage.unresolved[0]!.reason,"HISTORY_SOURCE_RECEIPT_CONFLICT");
  const response=proposeHistoricalReceiptResolutions(state(),[{...source(),responseId:"different-response"}],[artifact()]);
  assert.equal(response.proposed.length,0);
});

test("receipt reused for another ledger row or conflicting retained artifacts remains held",()=>{
  const old=state(["1","2"]);old.entries[1]!.responseId="retained-response-1";
  const reused=proposeHistoricalReceiptResolutions(old,[source()],[artifact()]);
  assert.equal(reused.proposed.length,0);assert.equal(reused.unresolved[0]!.reason,"HISTORY_PROVIDER_RECEIPT_REUSED");
  const conflicts=proposeHistoricalReceiptResolutions(state(),[source()],[artifact(),
    artifact({inputTokens:999},"22222222-2222-4222-8222-222222222222")]);
  assert.equal(conflicts.proposed.length,0);assert.equal(conflicts.unresolved[0]!.reason,"HISTORY_RECEIPT_AMBIGUOUS");
});

test("duplicate reference to the same private artifact is not a second independent receipt",()=>{
  const a=artifact(),report=proposeHistoricalReceiptResolutions(state(),[source()],[a,structuredClone(a)]);
  assert.equal(report.verifiedRetainedArtifacts,1);assert.equal(report.proposed.length,1);
});

test("one source identity with conflicting metadata cannot produce a reconciliation",()=>{
  const report=proposeHistoricalReceiptResolutions(state(),[source(),{...source(),role:"challenge"}],[artifact()]);
  assert.equal(report.proposed.length,0);assert.equal(report.unresolved[0]!.reason,"HISTORY_SOURCE_INVALID_OR_CONFLICTING");
});
