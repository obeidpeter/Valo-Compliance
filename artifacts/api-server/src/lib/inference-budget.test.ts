import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {emptyBudget,inferenceProposal,proposalTotals,tokenCost,budgetUsed,reserveBudget,requestDigest,
  transitionBudget,settleBudget,importPilotUsage,type BudgetState,type BudgetAuthority} from "./inference-budget";
import {managedCompletion} from "./managed-inference";
const fixtureAuthority:BudgetAuthority={enabled:true,ownerApproved:true,tokenizationVerified:true,managedPriceUpperBoundVerified:true};
const baseline=():BudgetState=>({...emptyBudget(),priorUseReconciled:true});
const input=(key="one",lane:"customer"|"publication"="customer")=>{
  const request={model:"gpt-5.4-mini",max_completion_tokens:8192,messages:[{role:"system",content:"full instructions"},
    {role:"user",content:"selected synthetic fields"}],response_format:{type:"json_schema",schema:{type:"object"}}};
  return{runKey:key,lane,request,bindingHash:requestDigest("source/prompt/policy/rights/schema-v1"),
    scopeHash:requestDigest("synthetic-scope"),now:100,
    proof:{requestHash:requestDigest(request),model:"gpt-5.4-mini",inputTokens:4096,
      method:"provider-attested-full-request" as const,attestationHash:requestDigest("SYNTHETIC-OFFLINE-ATTESTATION"),
      includesInstructionsAndSchema:true as const}};
};
test("exact proposal arithmetic and implicit customer 4096-token bound",()=>{
  const t=proposalTotals();assert.equal(t.baseNanoUsd,"25908480000");assert.equal(t.upliftNanoUsd,"28499328000");
  assert.equal(t.lanes[0]!.baseNanoUsd,"13146624000");assert.equal(t.lanes[0]!.upliftNanoUsd,"14461286400");
  assert.equal(tokenCost(32000,8192)*458n,30663283200n);
  assert.equal(BigInt(inferenceProposal.capNanoUsd)-BigInt(t.upliftNanoUsd),1500672000n);
});
test("real dispatch is disabled with no switch or SDK access",async()=>{
  assert.equal(inferenceProposal.enabled,false);
  await assert.rejects(managedCompletion("customer",{model:"gpt-5.4-mini",max_completion_tokens:8192,
    messages:[{role:"user",content:"synthetic"}]},{timeout:1,maxRetries:0}),/INFERENCE_BUDGET_DISABLED/);
  assert.throws(()=>reserveBudget(baseline(),inferenceProposal,input()),/DISABLED/);
});
test("all four current application dispatch sites use the shared held transport",async()=>{
  const paths=["../editorial/model-adapter.ts","../editorial/operational-review.ts",
    "../editorial/operational-authoring.ts","./valo-customer-ai-model.ts"];
  for(const path of paths){
    const source=await readFile(new URL(path,import.meta.url),"utf8");
    assert.match(source,/managedCompletion\(/);assert.doesNotMatch(source,/openai\.chat\.completions\.create/);
  }
});
test("byte estimates, changed instructions/schema and insufficient proofs cannot admit",()=>{
  for(const change of[(i:ReturnType<typeof input>)=>({...i,proof:null}),
    (i:ReturnType<typeof input>)=>({...i,request:{...i.request,response_format:{...i.request.response_format,schema:{type:"string"}}}}),
    (i:ReturnType<typeof input>)=>({...i,proof:{...i.proof,inputTokens:4097}})])
    assert.throws(()=>reserveBudget(baseline(),fixtureAuthority,change(input())),/TOKEN_BOUND/);
  assert.throws(()=>reserveBudget(baseline(),{...fixtureAuthority,managedPriceUpperBoundVerified:false},input()),/UNPROVEN/);
});
test("unknown pilot and unreconciled usage hold all lanes, import is idempotent",()=>{
  const rows=[{sourceKey:"reported",lane:"customer" as const,responseId:"synthetic-response",input:200,output:300,model:"gpt-5.4-mini"},
    {sourceKey:"timeout",lane:"publication" as const,responseId:null,input:null,output:null,model:null}];
  const first=importPilotUsage(emptyBudget(),rows);
  const second=importPilotUsage(first.state,rows);assert.equal(second.imported,0);
  assert.equal(second.state.entries.length,2);assert.equal(second.state.unboundedPrior.length,1);
  assert.equal(budgetUsed(second.state),tokenCost(200,300)); // plus explicitly unbounded prior liability
  assert.throws(()=>reserveBudget(second.state,fixtureAuthority,input()),/UNRECONCILED/);
});
test("reservation precedes dispatch, timeout keeps maximum and cannot be cancelled",()=>{
  const r=reserveBudget(baseline(),fixtureAuthority,input()),worst=tokenCost(4096,8192);
  assert.equal(budgetUsed(r.state),worst);
  const dispatched=transitionBudget(r.state,"one","dispatch"),unknown=transitionBudget(dispatched,"one","unknown");
  assert.equal(budgetUsed(unknown),worst);assert.throws(()=>transitionBudget(unknown,"one","cancel"),/UNSAFE/);
  assert.throws(()=>reserveBudget(unknown,fixtureAuthority,input()),/ALREADY_RESERVED/);
  const retry=reserveBudget(unknown,fixtureAuthority,input("retry"));
  assert.equal(budgetUsed(retry.state),2n*worst);
});
test("settlement is exact/idempotent, never releases unknown on elapsed time",()=>{
  let s=transitionBudget(reserveBudget(baseline(),fixtureAuthority,input()).state,"one","dispatch");
  const usage={input:230,output:147,responseId:"response-one",resultRef:"private-bound-result",freshUntil:1000};
  s=settleBudget(s,"one",usage);assert.equal(budgetUsed(s),tokenCost(230,147));
  assert.deepEqual(settleBudget(s,"one",usage),s);
  assert.throws(()=>settleBudget(s,"one",{...usage,output:148}),/CONFLICT/);
  const reused=reserveBudget(s,fixtureAuthority,input("same-fresh"));assert.equal(reused.dispatch,false);
  assert.equal(reserveBudget(s,inferenceProposal,{...input("disabled-cache-only"),proof:null}).dispatch,false);
  assert.equal(reused.reuse,"private-bound-result");assert.equal(reused.state.entries.length,1);
  const changed=input("changed");changed.bindingHash=requestDigest("changed-source");
  assert.equal(reserveBudget(s,fixtureAuthority,changed).dispatch,true);
  assert.equal(reserveBudget(s,fixtureAuthority,{...input("stale"),now:1001}).dispatch,true);
});
test("duplicate identity binds the entire request and scope",()=>{
  const s=reserveBudget(baseline(),fixtureAuthority,input()).state;
  assert.throws(()=>reserveBudget(s,fixtureAuthority,{...input(),scopeHash:requestDigest("other-workspace")}),/BINDING_CONFLICT/);
  assert.equal(transitionBudget(s,"one","cancel").entries[0]!.status,"cancelled");
});
test("atomic serialized racing reservations stop at lane limits without overspend",async()=>{
  let state=baseline(),queue=Promise.resolve();let admitted=0,denied=0;
  const reserve=(n:number)=>{const job=queue.then(()=>{
    try{state=reserveBudget(state,fixtureAuthority,input(`race-${n}`)).state;admitted++;}
    catch{denied++;}
  });queue=job;return job;};
  await Promise.all(Array.from({length:130},(_,i)=>reserve(i)));
  assert.equal(admitted,94);assert.equal(denied,36);assert.ok(budgetUsed(state)<=30000000000n);
});
test("depleted global allowance overrides every lane and prior pilot consumes headroom",()=>{
  const old=importPilotUsage(baseline(),[{sourceKey:"large-prior",lane:"customer",model:"gpt-5.4-mini",
    responseId:"past",input:36360000,output:0}]).state;
  old.priorUseReconciled=true; // synthetic billing reconciliation only, not runtime approval
  assert.throws(()=>reserveBudget(old,fixtureAuthority,input("new","publication")),/ALLOCATION_EXHAUSTED/);
});
test("reported bound breaches suspend admission; malformed/negative balances fail closed",()=>{
  const s=transitionBudget(reserveBudget(baseline(),fixtureAuthority,input()).state,"one","dispatch");
  const breached=settleBudget(s,"one",{input:4097,output:20,responseId:"breach",resultRef:"held",freshUntil:200});
  assert.equal(breached.suspended,true);assert.throws(()=>reserveBudget(breached,fixtureAuthority,input("retry")),/UNRECONCILED/);
  assert.throws(()=>budgetUsed({...s,entries:s.entries.map(e=>({...e,reserved:"-1"}))}),/INVALID/);
});
