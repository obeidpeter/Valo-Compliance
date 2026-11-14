import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {pool} from "@workspace/db";
import {InferenceBudgetStore} from "./inference-budget-store";
import {FiniteInferenceDispatcher,type FiniteWork,type FiniteManifest} from "./inference-batch-dispatch";
import {inferenceProposal,requestDigest,budgetUsed,tokenCost,emptyBudget} from "./inference-budget";
import type {ManagedCompletionResult} from "./managed-inference";

test("durable finite batch dispatch — isolated PostgreSQL and controlled transport, zero paid calls",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",timeout:60000,
},async t=>{
  const schema=`finite_${randomUUID().replaceAll("-","")}`,c=await pool.connect();
  try{
    await c.query(`CREATE SCHEMA "${schema}"`);await c.query(`SET search_path TO "${schema}"`);
    for(const file of["0018_inference_budget.sql","0020_inference_batch_authorization.sql"]){
      const ddl=await readFile(new URL(`../../../../lib/db/drizzle/${file}`,import.meta.url),"utf8");
      await c.query(ddl.replaceAll("--> statement-breakpoint",""));
    }
  }finally{await c.query("RESET search_path");c.release();}
  const store=new InferenceBudgetStore(pool,schema);
  const work=(key:string,lane:FiniteWork["lane"]="customer",pair:string|null=null,role:FiniteWork["role"]="customer"):FiniteWork=>({
    key,lane,pair,role,candidateHash:requestDigest("unchanged-candidate"),sourceHashes:[requestDigest("source")],
    caseHash:requestDigest("case"),bindings:{candidateVersionId:null,corpus:"customer-ai",caseId:"synthetic",
      sourceFiles:[]},
    request:{model:"gpt-5.4-mini",max_completion_tokens:8192,messages:[{role:"user",content:`synthetic:${key}`}]},
  });
  let sends=0,bindingValid=true;
  const response=():ManagedCompletionResult=>({id:`controlled-${randomUUID()}`,model:"gpt-5.4-mini",created:0,
    choices:[{finish_reason:"stop",message:{content:"{}"}}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160}});
  const dispatcher=new FiniteInferenceDispatcher(store,async()=>{sends++;return response();},
    async()=>{if(!bindingValid)throw Error("ACTUAL_BINDING_CHANGED");});
  const seed=async(works:FiniteWork[],enabled=true,expires=new Date(Date.now()+3600000),forged=false)=>{
    const id=`controlled-${randomUUID()}`,manifest:FiniteManifest={version:1,policyVersion:inferenceProposal.priceVersion,works};
    await pool.query(`INSERT INTO "${schema}".valo_inference_batches
      (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
      VALUES($1,$2,$3,$4,$5,'controlled-fixture-not-owner','isolated-test-only',now(),$6)`,
      [id,requestDigest(inferenceProposal),forged?requestDigest("forged"):requestDigest(manifest),JSON.stringify(manifest),enabled,expires]);
    return id;
  };
  const state=()=>store.mutate("inspect",s=>({state:s,value:s}));
  const reset=()=>store.mutate("isolated-fixture-reset",()=>({state:{...emptyBudget(),priorUseReconciled:true},value:null}));
  const run=(d:FiniteInferenceDispatcher,id:string,w:FiniteWork)=>d.withWork(id,w.key,()=>d.complete(w.lane,w.request,{timeout:100,maxRetries:0}));
  try{
    await reset();
    await t.test("disabled durable authority and missing allowlist cannot dispatch",async()=>{
      const w=work("disabled"),id=await seed([w],false);
      await assert.rejects(()=>run(dispatcher,id,w),/NOT_AUTHORIZED/);
      await assert.rejects(()=>dispatcher.withWork(awaitableId,"not-listed",async()=>null),/NOT_AUTHORIZED|ALLOWLISTED/);
      assert.equal(sends,0);
    });
    await t.test("authorized controlled work really dispatches and settles; unchanged result reuses without a call",async()=>{
      const w=work("one"),id=await seed([w]);
      const r=await run(dispatcher,id,w);assert.ok(r.id.startsWith("controlled-"));
      const s=await state();assert.equal(s.entries[0]!.status,"settled");
      assert.equal(s.entries[0]!.reserved,tokenCost(400000,8192).toString());
      assert.equal(budgetUsed(s),tokenCost(120,40));
      const before=sends;assert.equal((await run(dispatcher,id,w)).id,r.id);assert.equal(sends,before);
    });
    await t.test("review pair reserves atomically and charges its actual editorial lane",async()=>{
      await reset();
      const a=work("factual","editorial_evaluation","pair","factual"),b=work("challenge","editorial_evaluation","pair","challenge");
      const id=await seed([a,b]);await run(dispatcher,id,a);
      let s=await state();assert.equal(s.entries.length,2);assert.equal(s.entries[1]!.status,"reserved");
      assert.ok(s.entries.every(e=>e.lane==="editorial_evaluation"));
      await run(dispatcher,id,b);s=await state();assert.ok(s.entries.every(e=>e.status==="settled"));
      const ch=work("checker","checker_challenge",null,"challenge"),cid=await seed([ch]);
      await run(dispatcher,cid,ch);assert.equal((await state()).entries.at(-1)!.lane,"checker_challenge");
    });
    await t.test("changed request, source bindings, expiry and forged manifest stop before transport",async()=>{
      const w=work("binding"),id=await seed([w]),before=sends;
      await assert.rejects(()=>dispatcher.withWork(id,w.key,()=>dispatcher.complete(w.lane,
        {...w.request,messages:[{role:"user",content:"changed"}]},{timeout:100,maxRetries:0})),/REQUEST_MISMATCH/);
      bindingValid=false;await assert.rejects(()=>run(dispatcher,id,w),/BINDING_CHANGED/);bindingValid=true;
      await assert.rejects(()=>pool.query(`UPDATE "${schema}".valo_inference_batches SET
        manifest_hash=$2 WHERE id=$1`,[id,requestDigest("forged")]),{code:"23514"});
      const expired=await seed([w],true,new Date(Date.now()-1000));
      await assert.rejects(()=>run(dispatcher,expired,w),/EXPIRED/);
      const forged=await seed([w],true,new Date(Date.now()+3600000),true);
      await assert.rejects(()=>run(dispatcher,forged,w),/MANIFEST_INVALID/);assert.equal(sends,before);
    });
    await t.test("timeout keeps the whole reservation, duplicates cannot redispatch and new retry consumes another slot",async()=>{
      await reset();let attempts=0;
      const d=new FiniteInferenceDispatcher(store,async()=>{attempts++;throw Error("controlled timeout after acceptance");},async()=>{});
      const a=work("timed"),b=work("separate-retry"),id=await seed([a,b]);
      await assert.rejects(()=>run(d,id,a),/timeout/);
      await assert.rejects(()=>run(d,id,a),/ALREADY_DISPATCHED_OR_UNKNOWN/);
      await assert.rejects(()=>run(d,id,b),/timeout/);
      const s=await state();assert.equal(attempts,2);assert.equal(s.entries.length,2);
      assert.ok(s.entries.every(e=>e.status==="unknown"));assert.equal(budgetUsed(s),2n*tokenCost(400000,8192));
    });
    await t.test("concurrency two and duplicate runs cover every lane under one locked ledger",async()=>{
      await reset();let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});let calls=0;
      const d=new FiniteInferenceDispatcher(store,async()=>{calls++;await barrier;return response();},async()=>{});
      const works=[work("a"),work("b","checker_challenge",null,"challenge"),work("c")],id=await seed(works);
      const first=run(d,id,works[0]!);while(calls<1)await new Promise(r=>setTimeout(r,5));
      await assert.rejects(()=>run(d,id,works[0]!),/ALREADY_DISPATCHED_OR_UNKNOWN/);
      const second=run(d,id,works[1]!);while(calls<2)await new Promise(r=>setTimeout(r,5));
      await assert.rejects(()=>run(d,id,works[2]!),/CONCURRENCY_EXHAUSTED/);
      release();await Promise.all([first,second]);assert.equal(calls,2);
    });
    await t.test("policy adoption keeps old usage and all unresolved liability instead of resetting history",async()=>{
      const oldHash=requestDigest("previous-policy"),s=await state();
      await pool.query(`UPDATE "${schema}".valo_inference_budgets SET policy_hash=$2 WHERE id=$1`,[inferenceProposal.id,oldHash]);
      const result=await store.adoptPolicy(oldHash,"controlled-evidence-of-version-change");
      assert.equal(result.stateHash,requestDigest(s));assert.equal(result.enabled,false);assert.equal(result.ownerApproved,false);
    });
    await t.test("unreconciled historic liabilities and depleted ceiling hold all further calls",async()=>{
      const w=work("held"),id=await seed([w]),before=sends;
      await store.mutate("controlled-legacy-liability",s=>({state:{...s,priorUseReconciled:false,unboundedPrior:["controlled-unknown"]},value:null}));
      await assert.rejects(()=>run(dispatcher,id,w),/UNRECONCILED/);
      await store.mutate("controlled-depletion",()=>({state:{...emptyBudget(),priorUseReconciled:true,entries:[{
        runKey:"controlled-prior",lane:"customer",requestHash:requestDigest("prior"),bindingHash:requestDigest("prior"),
        scopeHash:requestDigest("prior"),inputBound:0,outputBound:0,reserved:"29999999999",charged:"29999999999",
        status:"settled",legacy:true,
      }]},value:null}));
      await assert.rejects(()=>run(dispatcher,id,w),/ALLOCATION_EXHAUSTED/);assert.equal(sends,before);
    });
  }finally{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();}
});
const awaitableId="nonexistent-controlled-batch";
