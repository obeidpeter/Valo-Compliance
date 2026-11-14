import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {pool} from "@workspace/db";
import {InferenceBudgetStore} from "./inference-budget-store";
import {emptyBudget,reserveBudget,requestDigest,budgetUsed,transitionBudget,settleBudget} from "./inference-budget";
test("isolated PostgreSQL global ledger serializes races and preserves unknown/retry liability",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",
},async()=>{
  const schema=`valo_budget_test_${randomUUID().replaceAll("-","")}`;
  const c=await pool.connect();
  try{
    await c.query(`CREATE SCHEMA "${schema}"`);
    await c.query(`SET search_path TO "${schema}"`);
    const ddl=await readFile(new URL("../../../../lib/db/drizzle/0018_inference_budget.sql",import.meta.url),"utf8");
    await c.query(ddl.replaceAll("--> statement-breakpoint",""));
  }finally{await c.query("RESET search_path");c.release();}
  const store=new InferenceBudgetStore(pool,schema);
  const authority={enabled:true,ownerApproved:true,tokenizationVerified:true,managedPriceUpperBoundVerified:true};
  const request={model:"gpt-5.4-mini",max_completion_tokens:8192,messages:[{role:"system",content:"synthetic"}]};
  const admission=(n:string)=>({runKey:n,lane:"customer" as const,request,bindingHash:requestDigest(n),
    scopeHash:requestDigest("synthetic-tenant"),now:100,proof:{requestHash:requestDigest(request),
      method:"provider-attested-full-request" as const,model:"gpt-5.4-mini",inputTokens:4000,
      attestationHash:requestDigest("OFFLINE-CONTROL-NOT-PROVIDER-PROOF"),includesInstructionsAndSchema:true as const}});
  try{
    await store.mutate("isolated_fixture_only",()=>({state:{...emptyBudget(),priorUseReconciled:true},value:null}));
    const results=await Promise.all(Array.from({length:110},(_,n)=>store.mutate("controlled_reserve",s=>{
      try{const r=reserveBudget(s,authority,admission(`race-${n}`));return{state:r.state,value:r.dispatch};}
      catch{return{state:s,value:false};}
    })));
    assert.equal(results.filter(Boolean).length,94);
    const snapshot=await store.mutate("inspect",s=>({state:s,value:s}));
    assert.equal(snapshot.entries.length,94);assert.ok(budgetUsed(snapshot)<=30000000000n);
    const first=snapshot.entries[0]!.runKey;
    await store.mutate("dispatch",s=>({state:transitionBudget(s,first,"dispatch"),value:null}));
    await store.mutate("timeout_unknown",s=>({state:transitionBudget(s,first,"unknown"),value:null}));
    await assert.rejects(store.mutate("unsafe_release",s=>({state:transitionBudget(s,first,"cancel"),value:null})),/UNSAFE/);
    const usage={input:200,output:100,responseId:"controlled-known-response",resultRef:"bound-private-ref",freshUntil:200};
    await store.mutate("reconcile_known_usage",s=>({state:settleBudget(s,first,usage),value:null}));
    await store.mutate("duplicate_settlement",s=>({state:settleBudget(s,first,usage),value:null}));
    const final=await store.mutate("inspect_final",s=>({state:s,value:s}));
    assert.equal(final.entries.filter(e=>e.status==="settled").length,1);
    assert.ok(budgetUsed(final)<budgetUsed(snapshot));
    const events=await pool.query(`SELECT count(*)::int AS n,count(DISTINCT version)::int AS versions
      FROM "${schema}".valo_inference_budget_events`);
    assert.equal(events.rows[0].n,events.rows[0].versions);
  }finally{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();}
});
