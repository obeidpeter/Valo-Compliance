import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pool} from "@workspace/db";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
import {InferenceBudgetStore} from "../lib/inference-budget-store";
import {inferenceProposal,requestDigest,budgetUsed,type BudgetState} from "../lib/inference-budget";
async function main(){
  assertDevelopmentRuntime();
  const root=resolve(import.meta.dirname,"../../../..");
  if(process.env.VALO_PREPARE_FINITE_INFERENCE!=="reviewed-disabled-development-only")throw Error("EXPLICIT_PREPARATION_REQUIRED");
  const c=await pool.connect();
  try{
    await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(747110)");
    const exists=await c.query("SELECT to_regclass('public.valo_inference_batches') as name");
    if(!exists.rows[0].name){
      const ddl=await readFile(resolve(root,"lib/db/drizzle/0020_inference_batch_authorization.sql"),"utf8");
      await c.query(ddl.replaceAll("--> statement-breakpoint",""));
    }
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  const old=(await pool.query("SELECT policy_hash,state FROM valo_inference_budgets WHERE id=$1",[inferenceProposal.id])).rows[0];
  if(!old)throw Error("EXISTING_USAGE_LEDGER_REQUIRED");
  const before=requestDigest(old.state);
  const store=new InferenceBudgetStore(pool);
  const adoption=await store.adoptPolicy(old.policy_hash,"owner-transmitted-context-fallback-and-finite-limits; controlled-dispatch-implementation");
  const state=old.state as BudgetState,retained=new Map<string,unknown>(),notes=[];
  for(const v of[1,2,3,4,5,6,8]){
    try{
      const bytes=await readFile(resolve(root,`docs/valo/evidence/operational-publication-v${v}.json`));
      const report=JSON.parse(bytes.toString()) as {reviews?:{providerResponseId?:string;model?:string}[]};
      for(const r of report.reviews??[])if(r.providerResponseId)retained.set(r.providerResponseId,{model:r.model});
      notes.push({version:v,fileHash:requestDigest(bytes.toString()),reviews:(report.reviews??[]).length});
    }catch{notes.push({version:v,unavailable:true});}
  }
  const known=state.entries.filter(e=>e.status==="settled").length;
  const unknown=state.entries.filter(e=>e.status==="unknown");
  const linked=unknown.filter(e=>e.responseId&&retained.has(e.responseId)).length;
  // No guessed candidate/role/time join can replace a provider receipt linked
  // to the exact charged attempt. Preserve unresolved entries and hard hold.
  const readback=(await pool.query("SELECT state FROM valo_inference_budgets WHERE id=$1",[inferenceProposal.id])).rows[0].state;
  if(requestDigest(readback)!==before)throw Error("POLICY_ADOPTION_CHANGED_USAGE");
  const approved=(await pool.query("SELECT count(*)::int n FROM valo_inference_batches WHERE enabled")).rows[0].n;
  const report={executedAt:new Date().toISOString(),policyAdoption:adoption,historyHash:before,
    potentialChargeRecords:state.entries.length,reportedUsageRecords:known,unknownRecords:unknown.length,
    unboundedLiabilities:state.unboundedPrior.length,provisionalReportedCostNanoUsd:budgetUsed(state).toString(),
    retainedReviewReceipts:retained.size,unknownExactReceiptLinks:linked,sourceNotes:notes,
    reconciliation:"Unresolved historic attempts retain a hard admission hold. No missing usage is zeroed; reported tokens are not an invoice.",
    availableBalance:null,approvedEnabledBatches:approved,ownerApproval:false,providerCalls:0,quotaChanges:false,
    fallbackPerAttemptNanoUsd:"370550400",allProviderPathsShared:true,productionMigration:false,
    nativeTriggerPublishing:"Requires reviewed bootstrap; managed schema publication cannot be assumed to copy functions/triggers.",
  };
  await writeFile(resolve(root,"docs/valo/evidence/finite-inference-preparation.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({potentialCharges:state.entries.length,unknown:unknown.length,unbounded:state.unboundedPrior.length,
    unknownExactReceiptLinks:linked,enabledBatches:approved,historyUnchanged:true,availableBalance:null,providerCalls:0}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:"FINITE_PREPARATION_FAILED");process.exitCode=1;}).finally(()=>pool.end());
