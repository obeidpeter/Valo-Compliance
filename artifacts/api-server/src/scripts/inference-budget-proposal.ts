import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {db,pool} from "@workspace/db";
import {sql} from "drizzle-orm";
import {inferenceProposal,proposalTotals,importPilotUsage,budgetUsed,requestDigest,type PilotUsage} from "../lib/inference-budget";
import {InferenceBudgetStore} from "../lib/inference-budget-store";
async function main(){
  if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT)throw Error("DEVELOPMENT_ONLY");
  const root=resolve(import.meta.dirname,"../../../..");
  let developmentDeltaApplied=false;
  if(process.argv.includes("--apply-reviewed-development-delta")){
    // Existing development tables predate a populated Drizzle ledger. Apply
    // only this reviewed additive delta; NEVER fabricate the earlier history.
    // Clean-install migration proof is a separate retained local-cluster run.
    const exists=await pool.query("select to_regclass('public.valo_inference_budgets') as name");
    if(exists.rows[0].name)throw Error("DELTA_ALREADY_EXISTS_USE_READ_ONLY_IMPORT");
    const ddl=await readFile(resolve(root,"lib/db/drizzle/0018_inference_budget.sql"),"utf8");
    await pool.query(ddl.replaceAll("--> statement-breakpoint",""));
    developmentDeltaApplied=true;
  }
  const rows:PilotUsage[]=[],sourceCounts:Record<string,number>={};
  const publications=await db.execute(sql`select id,role,provider_response_id,input_tokens,output_tokens,outcome
    from valo_publication_ai_attempts`);
  sourceCounts.publicationAttempts=publications.rows.length;
  for(const r of publications.rows)rows.push({sourceKey:`publication:${r.id}`,lane:"publication",
    responseId:r.provider_response_id as string|null,input:r.input_tokens as number|null,
    output:r.output_tokens as number|null,model:null}); // legacy table did not persist actual returned model
  const editorial=await db.execute(sql`select id,model,provider_response_id,input_tokens,output_tokens,status
    from valo_editorial_runs`);
  sourceCounts.editorialRuns=editorial.rows.length;
  for(const r of editorial.rows)rows.push({sourceKey:`editorial:${r.id}`,lane:"editorial_evaluation",
    responseId:r.provider_response_id as string|null,input:r.input_tokens as number|null,
    output:r.output_tokens as number|null,model:r.model as string|null});
  const customer=await db.execute(sql`select id,provider_runs,provider_calls,budget_reserved from valo_ai_drafts`);
  sourceCounts.customerDraftRows=customer.rows.length;
  for(const r of customer.rows){
    const runs=r.provider_runs as Record<string,unknown>[];
    if(!runs.length&&r.budget_reserved)rows.push({sourceKey:`customer-unresolved:${r.id}`,lane:"customer",
      responseId:null,input:null,output:null,model:null});
    for(const[at,run]of runs.entries()){
      if(run.outboundAttempted===false)continue; // explicitly recorded zero-outbound; never delete its source
      const usage=run.usage as {inputTokens?:number;outputTokens?:number}|null;
      rows.push({sourceKey:`customer:${r.id}:${at}`,lane:"customer",responseId:typeof run.responseId==="string"?run.responseId:null,
        input:usage?.inputTokens??null,output:usage?.outputTokens??null,model:typeof run.model==="string"?run.model:null});
    }
  }
  const store=new InferenceBudgetStore(pool);
  const imported=await store.mutate("import_pilot_metadata_disabled",s=>{
    const r=importPilotUsage(s,rows);return{state:r.state,value:{imported:r.imported,duplicates:r.duplicates,
      entries:r.state.entries.length,unbounded:r.state.unboundedPrior.length,
      knownUsageEstimateNanoUsd:budgetUsed(r.state).toString(),priorUseReconciled:r.state.priorUseReconciled}};
  });
  const dir=resolve(root,"generated-artifacts/valo-completion/inference-budget");
  await mkdir(dir,{recursive:true});
  const bindings=["artifacts/api-server/src/lib/inference-budget.ts","artifacts/api-server/src/lib/managed-inference.ts",
    "artifacts/api-server/src/lib/inference-budget-store.ts"];
  const codeHashes=Object.fromEntries(await Promise.all(bindings.map(async p=>[p,requestDigest(await readFile(resolve(root,p),"utf8"))])));
  const report={recordedAt:new Date().toISOString(),proposal:inferenceProposal,totals:proposalTotals(),sourceCounts,imported,
    developmentDeltaApplied,existingDevelopmentHistoryAdopted:false,productionMigrationApplied:false,
    codeHashes,providerCalls:0,quotasChanged:false,identitiesCreated:0,activationAvailable:false,
    actualBillingVerified:false,tokenCounterIntegrationVerified:false,
    holds:["OWNER_SPEND_APPROVAL_ABSENT","FULL_CHAT_REQUEST_TOKENIZATION_UNPROVED",
      "MANAGED_REGION_PRICE_BOUND_UNVERIFIED","PILOT_BILLING_AND_COVERAGE_UNRECONCILED"],
    notice:"Reported tokens give a provisional uncached-price estimate, not a billing receipt. Unknown/time-out/unmetered prior attempts are held without assuming zero. No finite remaining guarantee until reconciliation. This is application inference only, excluding tax, hosting, Agent usage and other projects."};
  await writeFile(resolve(dir,"proposal.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({disabled:true,providerCalls:0,sourceCounts,imported,base:report.totals.baseNanoUsd,uplift:report.totals.upliftNanoUsd}));
}
main().catch(()=>{console.error("Budget preparation held; no activation or billing reconciliation inferred.");process.exitCode=1;}).finally(()=>pool.end());
