import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {pool} from "@workspace/db";
import {InferenceBudgetStore} from "./inference-budget-store";
import {emptyBudget,importPilotUsage,requestDigest,inferenceProposal} from "./inference-budget";
import {classifyHistoricalInference,applyHistoricalClassifications,type HistoryEvidence,type HistoryRow} from "./inference-history-classification";

test("locked historical classification is resumable and concurrent without deleting any usage or approving spending",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",timeout:30000,
},async t=>{
  const schema=`history_${randomUUID().replaceAll("-","")}`,c=await pool.connect();
  try{
    await c.query(`CREATE SCHEMA "${schema}"`);await c.query(`SET search_path TO "${schema}"`);
    await c.query((await readFile(new URL("../../../../lib/db/drizzle/0018_inference_budget.sql",import.meta.url),"utf8"))
      .replaceAll("--> statement-breakpoint",""));
  }finally{await c.query("RESET search_path");c.release();}
  const store=new InferenceBudgetStore(pool,schema),rows:HistoryRow[]=["draft","factual","challenge"].map((role,i)=>({
    sourceKey:`editorial:controlled-${i}`,lane:"editorial_evaluation",id:`controlled-${i}`,role,model:"gpt-5-mini",
    responseId:null,input:null,output:null,candidateHash:null,inputHash:null,pipelineId:"controlled-only",
    status:role==="draft"?"failed":"dependency_held",failureCode:role==="draft"?"PROVIDER_FAILURE":"DRAFT_NOT_READY",
  }));
  const evidence:HistoryEvidence={rows,publicationAttempts:[],publicationArtifacts:[],editorialReceipts:[],
    sourceReferences:[{path:"controlled-fixture",sha256:requestDigest("controlled-byte-evidence")}],excludedNoOutboundCustomerRuns:12};
  const initial=importPilotUsage(emptyBudget(),rows.map(r=>({sourceKey:r.sourceKey,lane:r.lane,
    model:r.model,responseId:null,input:null,output:null}))).state;
  const apply=()=>store.mutate("controlled-classification",s=>({state:applyHistoricalClassifications(s,classifyHistoricalInference(s,evidence)),value:null}));
  try{
    await store.mutate("controlled-import",()=>({state:initial,value:null}));
    await t.test("crashed transaction leaves original state and prior events intact",async()=>{
      await assert.rejects(()=>store.mutate("controlled-crash",s=>{
        applyHistoricalClassifications(s,classifyHistoricalInference(s,evidence));throw Error("CONTROLLED_INTERRUPTION");
      }),/CONTROLLED_INTERRUPTION/);
      const s=(await pool.query(`SELECT state FROM "${schema}".valo_inference_budgets`)).rows[0].state;
      assert.deepEqual(s,initial);
    });
    await t.test("eight concurrent calls and a repeated call classify exactly once and retain all original entries",async()=>{
      await Promise.all(Array.from({length:8},apply));await apply();
      const s=(await pool.query(`SELECT state FROM "${schema}".valo_inference_budgets`)).rows[0].state;
      assert.equal(s.entries.length,3);assert.equal(s.historyResolutions.length,3);
      assert.deepEqual(s.historyResolutions.map((r:{before:unknown})=>r.before),initial.entries);
      assert.equal(s.entries.filter((r:{status:string})=>r.status==="cancelled").length,2);
      assert.equal(s.unboundedPrior.length,1);assert.equal(s.priorUseReconciled,false);
      assert.equal(s.entries.find((r:{status:string})=>r.status==="unknown").model,undefined);
    });
    await t.test("policy adoption preserves unresolved failed-call history rather than minting authority",async()=>{
      const old=requestDigest("old-controlled-policy");
      const before=(await pool.query(`SELECT state FROM "${schema}".valo_inference_budgets`)).rows[0].state;
      await pool.query(`UPDATE "${schema}".valo_inference_budgets SET policy_hash=$1`,[old]);
      await assert.rejects(()=>apply(),/POLICY_CHANGED/);
      const adoption=await store.adoptPolicy(old,"controlled-reviewed-price-evidence");
      assert.equal(adoption.ownerApproved,false);assert.equal(adoption.enabled,false);
      const after=(await pool.query(`SELECT state,policy_hash FROM "${schema}".valo_inference_budgets`)).rows[0];
      assert.equal(after.policy_hash,requestDigest(inferenceProposal));assert.deepEqual(after.state,before);
    });
  }finally{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}
});
