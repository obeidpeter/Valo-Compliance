import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {PgDialect} from "drizzle-orm/pg-core";
import type {SQL} from "drizzle-orm";
import {candidateDigest,disclosure,publicationSchema} from "@workspace/valo-core";
import {additionalInferenceAllocation,budgetUsed,emptyBudget,inferenceProposal,requestDigest,validateBudgetState,
  type BudgetState} from "./inference-budget";
import type {FiniteManifest,FiniteWork} from "./inference-batch-dispatch";
import type {ManagedCompletionResult,ManagedRequest} from "./managed-inference";
import type {ArtifactRef} from "../editorial/publication-artifacts";
import type {OperationalServerEvidence} from "../editorial/operational-review";

test("actual operational caller recovers an artifact failure from settled receipts without new attempts or SDK calls",async t=>{
  // The database adapters, native artifact store, SDK and content-binding
  // dependency are controlled here. Actual request/plan validation, role
  // contexts, finite dispatcher, settlement, caching and caller recovery run.
  // This is not a publication eligibility, native-storage or provider proof.
  const previous={nodeEnv:process.env.NODE_ENV,deployment:process.env.REPLIT_DEPLOYMENT};
  process.env.NODE_ENV="development";delete process.env.REPLIT_DEPLOYMENT;
  const originalFetch=globalThis.fetch;let unexpectedNetwork=0;
  globalThis.fetch=async()=>{unexpectedNetwork++;throw Error("NETWORK_DISABLED_DURING_RECOVERY_TEST");};
  t.after(()=>{
    globalThis.fetch=originalFetch;
    for(const[name,value]of [["NODE_ENV",previous.nodeEnv],["REPLIT_DEPLOYMENT",previous.deployment]] as const)
      if(value===undefined)delete process.env[name];else process.env[name]=value;
  });
  type Attempt={id:string;candidateHash:string;role:string;requestHash:string;outcome:string;
    responseId?:string;input?:number;output?:number;errorCode?:string};
  let attempts:Attempt[]=[],attemptInserts=0,nextAttempt=0;
  const dialect=new PgDialect();
  const execute=async(query:SQL)=>{
    const converted=dialect.sqlToQuery(query),text=converted.sql.replace(/\s+/g," ").trim(),p=converted.params;
    if(text.startsWith("select pg_advisory_xact_lock"))return{rows:[]};
    if(text.startsWith("select count(*)"))throw Error("UNEXPECTED_LEGACY_DAILY_THROTTLE");
    if(text.startsWith("select id from valo_publication_ai_attempts"))return{rows:attempts.filter(a=>
      a.candidateHash===p[0]&&a.role===p[1]&&a.requestHash===p[2]).map(a=>({id:a.id}))};
    if(text.startsWith("insert into valo_publication_ai_attempts")){
      const row={id:String(++nextAttempt),candidateHash:String(p[0]),role:String(p[1]),requestHash:String(p[2]),outcome:"reserved"};
      attempts.push(row);attemptInserts++;return{rows:[{id:row.id}]};
    }
    if(text.startsWith("update valo_publication_ai_attempts set outcome='response_received'")){
      const row=attempts.find(a=>a.id===p[3]&&a.requestHash===p[4]);assert.ok(row);
      Object.assign(row,{outcome:"response_received",responseId:p[0],input:p[1],output:p[2]});return{rows:[]};
    }
    if(text.startsWith("update valo_publication_ai_attempts set outcome='completed'")){
      const row=attempts.find(a=>a.id===p[0]&&a.requestHash===p[1]);assert.ok(row);row.outcome="completed";return{rows:[]};
    }
    if(text.startsWith("update valo_publication_ai_attempts set outcome='failed'")){
      const row=attempts.find(a=>a.id===p[1]&&a.requestHash===p[2]);assert.ok(row);
      row.outcome="failed";row.errorCode=String(p[0]);return{rows:[]};
    }
    throw Error("UNEXPECTED_OPERATIONAL_TEST_SQL");
  };
  const database={execute,transaction:async<T>(fn:(tx:{execute:typeof execute})=>Promise<T>)=>{
    const before=structuredClone(attempts);try{return await fn({execute});}catch(error){attempts=before;throw error;}
  }};
  let state:BudgetState={...emptyBudget(),priorUseReconciled:true};
  type Batch={manifest:FiniteManifest;manifest_hash:string;policy_hash:string;enabled:boolean;approved_by:string;
    approval_reference:string;approved_at:string;expires_at:string;results:Record<string,ManagedCompletionResult>};
  let batch:Batch,tail=Promise.resolve();
  class MemoryBudgetStore{
    constructor(..._args:unknown[]){}
    schemaName(){return"public";}
    allocationId(){return additionalInferenceAllocation.id;}
    async mutate<T>(_action:string,fn:(s:BudgetState,c:{query:(text:string,values?:unknown[])=>Promise<{rows:unknown[]}>})=>
      Promise<{state:BudgetState;value:T}>|{state:BudgetState;value:T}){
      let release!:()=>void;const previous=tail;tail=new Promise<void>(r=>{release=r;});await previous;
      const nextBatch=structuredClone(batch);
      const client={query:async(text:string,values:unknown[]=[])=>{
        if(text.startsWith('SELECT * FROM "public".valo_inference_batches'))return{rows:[nextBatch]};
        if(text.startsWith('UPDATE "public".valo_inference_batches')&&text.includes("jsonb_set")){
          nextBatch.results[String(values[1])]=JSON.parse(String(values[2]));return{rows:[]};
        }
        throw Error("UNEXPECTED_BUDGET_TEST_SQL");
      }};
      try{const result=await fn(structuredClone(state),client);validateBudgetState(result.state);
        state=result.state;batch=nextBatch;return result.value;}finally{release();}
    }
  }
  const artifacts=new Map<string,Buffer>();let failFactualArtifact=true,failedArtifactWrites=0;
  const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
  const put=async(bytes:Buffer,extension:ArtifactRef["extension"]):Promise<ArtifactRef>=>{
    const value=JSON.parse(bytes.toString());
    if(value.role==="factual"&&failFactualArtifact){failFactualArtifact=false;failedArtifactWrites++;
      throw Error("CONTROLLED_ARTIFACT_WRITE_FAILURE");}
    const ref={id:randomUUID(),hash:hash(bytes),extension};artifacts.set(ref.id,Buffer.from(bytes));return ref;
  };
  const get=async(ref:ArtifactRef)=>{const bytes=artifacts.get(ref.id);assert.ok(bytes);assert.equal(hash(bytes),ref.hash);return bytes;};
  let sdkCalls=0,bindingChecks=0;
  const sdkRequests:ManagedRequest[]=[];
  t.mock.module("@workspace/db",{namedExports:{db:database,pool:{connect:()=>{throw Error("UNEXPECTED_REAL_DATABASE");}}}});
  t.mock.module(new URL("./inference-budget-store.ts",import.meta.url).href,{namedExports:{InferenceBudgetStore:MemoryBudgetStore}});
  t.mock.module(new URL("./inference-work-bindings.ts",import.meta.url).href,{namedExports:{
    assertFiniteWorkBindings:async(work:FiniteWork)=>{bindingChecks++;assert.equal(work.lane,"publication");},
  }});
  t.mock.module(new URL("../editorial/publication-artifacts.ts",import.meta.url).href,{namedExports:{
    putPublicationArtifact:put,getPublicationArtifact:get,
  }});
  t.mock.module("@workspace/integrations-openai-ai-server/batch",{namedExports:{
    batchProcess:async<T,R>(entries:T[],fn:(entry:T)=>Promise<R>,options:{concurrency:number;retries:number})=>{
      assert.equal(entries.length,2);assert.equal(options.concurrency,1);assert.equal(options.retries,0);
      const results:R[]=[];for(const entry of entries)results.push(await fn(entry));return results;
    },
  }});
  t.mock.module("@workspace/integrations-openai-ai-server",{namedExports:{openai:{chat:{completions:{
    create:async(request:ManagedRequest,options:{maxRetries:number})=>{
      assert.equal(options.maxRetries,0);sdkCalls++;sdkRequests.push(structuredClone(request));
      return{id:`controlled-operational-${sdkCalls}`,model:"gpt-5.4-mini-2026-03-17",created:Math.floor(Date.now()/1000),
        choices:[{finish_reason:"stop",message:{content:JSON.stringify({verdict:"hold",findings:["Synthetic control only"],
          missingEvidence:[],observations:[]})}}],usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}} satisfies ManagedCompletionResult;
    },
  }}}}});
  const{saveOperationalReviewPlan,executeOperationalReviewPlan}=await import("../editorial/operational-review");
  const{withApprovedInferencePair}=await import("./managed-inference");
  const candidate=publicationSchema.shape.candidate.parse({id:"TPL-07",version:999,body:"Synthetic recovery test only",
    hash:"0".repeat(64),contentClass:"general_template",jurisdiction:"NG",risk:"general",scope:"Test fixture only",
    limitations:"Not publication or native-storage evidence",assumptions:[],unresolvedMaterialIssues:[],missingEvidence:[],
    sourceCheckDate:new Date(Date.now()-5000).toISOString(),reviewBy:new Date(Date.now()+3600000).toISOString(),
    disclosure,evidenceMode:"original_operational",legalScopeStatus:"not_applicable",claims:[]});
  candidate.hash=candidateDigest(candidate);
  const evidence:OperationalServerEvidence={candidateHash:candidate.hash,policyHash:"a".repeat(64),
    sourceCheckedAt:candidate.sourceCheckDate,sourceHash:"b".repeat(64),provenanceArtifactHash:"c".repeat(64),
    rightsArtifactHash:"d".repeat(64),exportReportArtifactHash:"e".repeat(64),providerSnapshotHash:"f".repeat(64),
    authoringRoute:"synthetic control",sourceAttribution:"synthetic control",performedChecks:[]};
  const plan=await saveOperationalReviewPlan(candidate,{scope:"synthetic"},{scope:"synthetic"},{scope:"synthetic"},evidence);
  assert.equal(plan.manifest.status,"mechanically_planned_not_reserved");
  const works:FiniteWork[]=plan.entries.map(entry=>({key:`operational-${entry.role}`,lane:"publication",role:entry.role,
    pair:"operational-pair",candidateHash:candidate.hash,caseHash:requestDigest({synthetic:"recovery"}),sourceHashes:[],
    request:entry.request,bindings:{candidateVersionId:"44444444-4444-4444-8444-444444444444",corpus:null,caseId:null,
      sourceFiles:[],operationalPlan:plan.artifact}}));
  const manifest:FiniteManifest={version:2,policyVersion:inferenceProposal.priceVersion,allocation:{...additionalInferenceAllocation},
    preparedAt:new Date(Date.now()-2000).toISOString(),works};
  batch={manifest,manifest_hash:requestDigest(manifest),policy_hash:requestDigest(inferenceProposal),enabled:true,
    approved_by:"synthetic test only",approval_reference:"controlled adapter; not owner approval",
    approved_at:new Date(Date.now()-1000).toISOString(),expires_at:plan.manifest.expiresAt,results:{}};
  const run=()=>withApprovedInferencePair("operational-recovery-test","operational-pair",
    ()=>executeOperationalReviewPlan(plan,candidate,evidence));
  const first=await run();
  assert.equal(sdkCalls,2);assert.equal(failedArtifactWrites,1);assert.equal(first.length,1);
  assert.equal(first[0]!.record.role,"challenge");assert.equal(first[0]!.record.outboundAttempted,true);
  assert.equal(attemptInserts,2);assert.equal(attempts.length,2);
  assert.deepEqual(attempts.map(a=>a.outcome).sort(),["completed","failed"]);
  assert.equal(state.entries.length,2);assert.ok(state.entries.every(e=>e.status==="settled"));
  assert.notEqual(requestDigest(sdkRequests[0]),requestDigest(sdkRequests[1]));
  const ids=attempts.map(a=>a.id),receiptIds=attempts.map(a=>a.responseId),ledgerHash=requestDigest(state),cost=budgetUsed(state);
  const second=await run();
  assert.equal(second.length,2);assert.equal(sdkCalls,2,"artifact recovery must not call the SDK again");
  assert.equal(attemptInserts,2);assert.deepEqual(attempts.map(a=>a.id),ids);assert.deepEqual(attempts.map(a=>a.responseId),receiptIds);
  assert.ok(attempts.every(a=>a.outcome==="completed"));assert.equal(requestDigest(state),ledgerHash);assert.equal(budgetUsed(state),cost);
  assert.ok(second.every(r=>r.record.outboundAttempted===false));
  for(const review of second){const retained=JSON.parse((await get(review.artifact)).toString());
    assert.equal(retained.providerResponseId,review.record.providerResponseId);assert.equal(retained.reviewPlanHash,plan.artifact.hash);}
  assert.ok(bindingChecks>=4);assert.equal(unexpectedNetwork,0);
});
