import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {additionalInferenceAllocation,emptyBudget,inferenceProposal,requestDigest,validateBudgetState,type BudgetState}
  from "./inference-budget";
import type {FiniteManifest,FiniteWork} from "./inference-batch-dispatch";
import type {ManagedCompletionResult,ManagedRequest} from "./managed-inference";

type Batch={id:string;enabled:boolean;approved_by:string;approval_reference:string;approved_at:string;
  expires_at:string;policy_hash:string;manifest_hash:string;manifest:FiniteManifest;results:Record<string,ManagedCompletionResult>};
type SQLClient={query:(sql:string,values?:unknown[])=>Promise<{rows:unknown[]}>};

test("default managed entry and customer organizer use actual finite dispatch and real corpus bindings",async t=>{
  await t.test("disabled default entry imports neither database configuration nor SDK",()=>{
    const url=new URL("./managed-inference.ts",import.meta.url).href;
    const code=`import assert from 'node:assert/strict';
      const {managedCompletion}=await import(${JSON.stringify(url)});
      await assert.rejects(()=>managedCompletion('customer',{model:'gpt-5.4-mini',max_completion_tokens:8192,
        messages:[{role:'user',content:'synthetic'}]},{timeout:1000,maxRetries:0}),/INFERENCE_BUDGET_DISABLED/);
      console.log('DISABLED_WITHOUT_DATABASE_OR_SDK');`;
    const result=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",code],{
      cwd:fileURLToPath(new URL("../../..",import.meta.url)),encoding:"utf8",
      env:{...process.env,NODE_ENV:"development",DATABASE_URL:"",AI_INTEGRATIONS_OPENAI_API_KEY:"",OPENAI_API_KEY:""},
      timeout:15000});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/DISABLED_WITHOUT_DATABASE_OR_SDK/);
  });

  // Only the database ledger adapter and SDK transport are controlled. The
  // real managed entry point, dispatcher, binding verifier, corpus file,
  // request constructor, schema validation and draft builder execute below.
  const batches=new Map<string,Batch>();
  let state:BudgetState={...emptyBudget(),priorUseReconciled:true};
  let tail=Promise.resolve(),sdkCalls=0,unexpectedNetwork=0;
  const received:ManagedRequest[]=[];
  const responses:string[]=[];
  class MemoryBudgetStore{
    constructor(..._args:unknown[]){}
    schemaName(){return"public";}
    allocationId(){return additionalInferenceAllocation.id;}
    async mutate<T>(_action:string,fn:(s:BudgetState,c:SQLClient)=>Promise<{state:BudgetState;value:T}>|{state:BudgetState;value:T}){
      let release!:()=>void;
      const previous=tail;tail=new Promise<void>(resolve=>{release=resolve;});await previous;
      const copies=new Map([...batches].map(([key,value])=>[key,structuredClone(value)]));
      const client:SQLClient={query:async(sql,values=[])=>{
        if(sql.startsWith('SELECT * FROM "public".valo_inference_batches')){
          const row=copies.get(String(values[0]));return{rows:row?[row]:[]};
        }
        if(sql.startsWith('UPDATE "public".valo_inference_batches')&&sql.includes("jsonb_set")){
          const row=copies.get(String(values[0]));assert.ok(row);row.results[String(values[1])]=JSON.parse(String(values[2]));
          return{rows:[]};
        }
        throw Error("UNEXPECTED_TEST_SQL");
      }};
      try{
        const next=await fn(structuredClone(state),client);validateBudgetState(next.state);
        state=next.state;batches.clear();for(const[key,value]of copies)batches.set(key,value);
        return next.value;
      }finally{release();}
    }
  }
  const originalEnvironment={nodeEnv:process.env.NODE_ENV,deployment:process.env.REPLIT_DEPLOYMENT,
    enabled:process.env.VALO_CUSTOMER_AI_ENABLED};
  process.env.NODE_ENV="development";delete process.env.REPLIT_DEPLOYMENT;delete process.env.VALO_CUSTOMER_AI_ENABLED;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{unexpectedNetwork++;throw Error("NETWORK_DISABLED_DURING_ENTRY_TEST");};
  t.after(()=>{
    globalThis.fetch=originalFetch;
    for(const[name,value]of [["NODE_ENV",originalEnvironment.nodeEnv],["REPLIT_DEPLOYMENT",originalEnvironment.deployment],
      ["VALO_CUSTOMER_AI_ENABLED",originalEnvironment.enabled]] as const)
      if(value===undefined)delete process.env[name];else process.env[name]=value;
  });
  t.mock.module("@workspace/db",{namedExports:{pool:{connect:()=>{throw Error("UNEXPECTED_REAL_LEDGER_CONNECTION");}}}});
  t.mock.module(new URL("./inference-budget-store.ts",import.meta.url).href,{namedExports:{InferenceBudgetStore:MemoryBudgetStore}});
  t.mock.module("@workspace/integrations-openai-ai-server",{namedExports:{openai:{chat:{completions:{
    create:async(request:ManagedRequest,options:{timeout:number;maxRetries:number})=>{
      sdkCalls++;received.push(structuredClone(request));assert.equal(options.maxRetries,0);
      assert.ok(options.timeout>0&&options.timeout<=45000);
      const content=responses.shift();assert.notEqual(content,undefined,"Test response must be explicitly supplied");
      return{id:`controlled-default-sdk-${sdkCalls}`,model:"gpt-5.4-mini-2026-03-17",created:Math.floor(Date.now()/1000),
        choices:[{finish_reason:"stop",message:{content:content!}}],
        usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}} satisfies ManagedCompletionResult;
    },
  }}}}});
  const {managedCompletion,withApprovedInferenceWork}=await import("./managed-inference");
  const {organizeCustomerDraft,customerCompletionRequest}=await import("./valo-customer-ai-model");
  const {customerAIInput,customerProviderPayload}=await import("./valo-customer-ai-domain");
  const path="docs/evaluation-candidates/customer-ai.json";
  const bytes=await readFile(new URL("../../../../"+path,import.meta.url));
  const corpus=JSON.parse(bytes.toString()) as {cases:{caseID:string;task:string;suppliedFacts:{
    parties:{business:string;customer:string};reference:string;issueDate:string;dueDate:string;
    lines:{description:string;quantity:string;unitPrice:string}[]}}[]};
  const source=corpus.cases.find(c=>c.caseID==="CAI-CAND-INV-01");assert.ok(source);
  const input=customerAIInput.parse({task:"invoice",tone:"polite",issuerName:source.suppliedFacts.parties.business,
    recipientName:source.suppliedFacts.parties.customer,documentNumber:source.suppliedFacts.reference,
    issueDate:source.suppliedFacts.issueDate,dueDate:source.suppliedFacts.dueDate,contextLines:[],
    financialInput:{kind:"invoice",lines:source.suppliedFacts.lines.map(line=>{
      assert.match(line.unitPrice,/^\d+\.\d{2}$/);
      return{description:line.description,quantity:line.quantity,unitPriceKobo:line.unitPrice.replace(".","")};
    }),taxAmountKobo:null,taxLabel:"",discountKobo:null,amountDueKobo:null},processingConsent:true,
    idempotencyKey:"33333333-3333-4333-8333-333333333333"});
  const request=customerCompletionRequest(customerProviderPayload(input));
  const caseHash=requestDigest(source),sourceHash=createHash("sha256").update(bytes).digest("hex");
  let batchNumber=0;
  function prepare(options:{retry?:boolean;modify?:(work:FiniteWork)=>void}={}){
    const id=`controlled-entry-${++batchNumber}`,key=`${id}:attempt-1`;
    const work:FiniteWork={key,lane:"customer",role:"customer",pair:null,candidateHash:caseHash,caseHash,
      sourceHashes:[sourceHash],request:structuredClone(request),bindings:{candidateVersionId:null,
        corpus:"customer-ai",caseId:source.caseID,sourceFiles:[{path,sha256:sourceHash}]}};
    options.modify?.(work);
    const works=[work];if(options.retry)works.push({...structuredClone(work),key:`${id}:attempt-2`,retryOf:key});
    const manifest:FiniteManifest={version:2,policyVersion:inferenceProposal.priceVersion,
      allocation:{...additionalInferenceAllocation},preparedAt:new Date(Date.now()-2000).toISOString(),works};
    batches.set(id,{id,manifest,manifest_hash:requestDigest(manifest),policy_hash:requestDigest(inferenceProposal),
      enabled:true,approved_by:"synthetic-test-only",approval_reference:"controlled-node-test-not-owner-approval",
      approved_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),results:{}});
    return{id,key};
  }
  await t.test("approved context reaches the actual default entry and settles the exact work",async()=>{
    const batch=prepare(),before=sdkCalls;responses.push(JSON.stringify({opening:"none",sections:[]}));
    let outbound=0;
    const result=await withApprovedInferenceWork(batch.id,batch.key,
      ()=>managedCompletion("customer",request,{timeout:18000,maxRetries:0,onOutbound:()=>{outbound++;}}));
    assert.equal(sdkCalls-before,1);assert.equal(outbound,1);assert.equal(result.model,"gpt-5.4-mini-2026-03-17");
    assert.equal(state.entries.find(e=>e.runKey===`${batch.id}:${batch.key}`)?.status,"settled");
    assert.deepEqual(received.at(-1),request);assert.equal(inferenceProposal.enabled,false);
  });
  await t.test("request, actual source hash and actual case binding mismatches make zero SDK calls",async()=>{
    const before=sdkCalls;
    const altered=prepare();await assert.rejects(()=>withApprovedInferenceWork(altered.id,altered.key,
      ()=>managedCompletion("customer",{...request,messages:[{role:"user",content:"altered request"}]},
        {timeout:18000,maxRetries:0})),/WORK_REQUEST_MISMATCH/);
    const badSource=prepare({modify:w=>{w.bindings.sourceFiles[0]!.sha256="d".repeat(64);}});
    await assert.rejects(()=>withApprovedInferenceWork(badSource.id,badSource.key,()=>Promise.resolve()),/SOURCE_BINDING_CHANGED/);
    const badCase=prepare({modify:w=>{w.caseHash="e".repeat(64);w.candidateHash=w.caseHash;}});
    await assert.rejects(()=>withApprovedInferenceWork(badCase.id,badCase.key,()=>Promise.resolve()),/CASE_BINDING_CHANGED/);
    assert.equal(sdkCalls,before);
  });
  await t.test("actual default customer organizer uses two separately approved attempts after invalid schema",async()=>{
    const batch=prepare({retry:true}),before=sdkCalls;responses.push("{}",JSON.stringify({opening:"none",sections:[]}));
    const result=await withApprovedInferenceWork(batch.id,batch.key,()=>organizeCustomerDraft(input));
    assert.equal(sdkCalls-before,2);assert.equal(result.failureCode,null);assert.ok(result.plan);
    assert.deepEqual(result.runs.map(r=>r.outcome),["invalid_structured_plan","validated"]);
    assert.deepEqual(result.runs.map(r=>r.outboundAttempted),[true,true]);
    const entries=state.entries.filter(e=>e.runKey.startsWith(`${batch.id}:`));
    assert.equal(entries.length,2);assert.equal(new Set(entries.map(e=>e.runKey)).size,2);
    assert.ok(entries.every(e=>e.status==="settled"));
    assert.notEqual(entries[0]!.responseId,entries[1]!.responseId);
  });
  await t.test("actual default customer organizer stops after one invalid response without a retry grant",async()=>{
    const batch=prepare(),before=sdkCalls;responses.push("{}");
    const result=await withApprovedInferenceWork(batch.id,batch.key,()=>organizeCustomerDraft(input));
    assert.equal(sdkCalls-before,1);assert.equal(result.plan,null);assert.equal(result.failureCode,"AI_MANAGED_BUDGET_HELD");
    assert.deepEqual(result.runs.map(r=>r.outcome),["invalid_structured_plan","budget_held"]);
    assert.deepEqual(result.runs.map(r=>r.outboundAttempted),[true,false]);
    assert.equal(state.entries.filter(e=>e.runKey.startsWith(`${batch.id}:`)).length,1);
  });
  assert.equal(unexpectedNetwork,0);assert.equal(responses.length,0);
});
