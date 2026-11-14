import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {and,eq,inArray,sql} from "drizzle-orm";
import {db,pool,valoAIDrafts,valoSafetySwitches} from "@workspace/db";
import {sha256} from "@workspace/valo-core";
import {createCustomerAIDraft,customerAIUsage} from "../lib/valo-customer-ai";
import {customerPreview,hashAI,missingCustomerFields,unsupportedCustomerInput,customerPromptVersion,customerNoticeVersion} from "../lib/valo-customer-ai-domain";
import {bindCustomerCase,explicitBoundaryFollowup,type AuthoredCustomerCase} from "../lib/valo-customer-case-binding";
import {getDocument,saveDocument} from "../lib/valo-store";
import {documentInput} from "../lib/valo-validation";
import {downloadExport} from "../lib/valo-exports";
async function main(){
  assert.equal(process.env.NODE_ENV,"development");assert.ok(!process.env.REPLIT_DEPLOYMENT);
  assert.equal(process.env.VALO_SOURCE_AI_CONTROLS,"existing-identity-negative-only");
  const root=resolve(import.meta.dirname,"../../../.."),out=resolve(root,"generated-artifacts/valo-completion/customer-native-boundaries");
  await mkdir(out,{recursive:true});
  const corpus=JSON.parse(await readFile(resolve(root,"docs/evaluation-candidates/customer-ai.json"),"utf8")) as {cases:AuthoredCustomerCase[]};
  const journey=JSON.parse(await readFile(resolve(root,"docs/valo/evidence/source-quotation-private-journey.json"),"utf8"));
  const[anchor]=await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.id,journey.providerPreviewId));
  assert.ok(anchor&&anchor.actorId.startsWith("valo-ai-eval-invoice-"),"Existing evaluation identity required");
  const actor={workspaceId:anchor.workspaceId,identityId:anchor.actorId};
  const beforeUsage=await customerAIUsage(actor);
  assert.ok(beforeUsage.enabled&&beforeUsage.globalAvailable&&beforeUsage.workspaceUsed<beforeUsage.workspaceDailyLimit,
    "Baseline must permit generation; do not claim the intended boundary when another stop is active");
  const actualRows=()=>db.select({id:valoAIDrafts.id,calls:valoAIDrafts.providerCalls,runs:valoAIDrafts.providerRuns,
    hash:valoAIDrafts.inputHash,reserved:valoAIDrafts.budgetReserved}).from(valoAIDrafts)
    .where(eq(valoAIDrafts.workspaceId,actor.workspaceId));
  const realBefore=await actualRows(),records:Record<string,unknown>[]=[];
  let calls=0;const forbiddenAdapter=async()=>{calls++;throw Error("PROVIDER_BOUNDARY_WAS_REACHED_UNEXPECTEDLY");};
  const fakeIds:string[]=[],negativeIds:string[]=[];
  const flagKey=`customer_ai_workspace:${actor.workspaceId}`,marker=`source-control:${randomUUID()}`;
  const[oldFlag]=await db.select().from(valoSafetySwitches).where(eq(valoSafetySwitches.key,flagKey));
  const[globalBefore]=await db.select().from(valoSafetySwitches).where(eq(valoSafetySwitches.key,"customer_ai"));
  let installedFlag=false,cleanupSucceeded=false;
  const preserveManual=async(label:string)=>{
    const prior=await getDocument(actor,journey.documentId);
    const canonical=documentInput.parse({title:prior.title,content:prior.content});
    const beforeFinancial=hashAI(canonical.content.financialInput),token=`Synthetic ${label} boundary manual edit.`;
    canonical.content.fields.notes+="\n"+token;
    const saved=await saveDocument(actor,prior.id,{...canonical,expectedRevision:prior.revision});
    const current=documentInput.parse({title:saved.title,content:saved.content});
    assert.equal(hashAI(current.content.financialInput),beforeFinancial);
    assert.ok(current.content.fields.notes.includes(token));
    const downloads=[];
    for(const file of journey.files){
      const actual=await downloadExport(actor,file.jobId);
      assert.equal(sha256(actual.bytes),file.hash);
      downloads.push({format:file.format,hash:file.hash,privateHistoricalDownloadUnchanged:true});
    }
    return{savedRevision:saved.revision,financialFactsUnchanged:true,manualWritePassed:true,downloads};
  };
  try{
    for(const caseID of["CAI-CAND-QUO-14","CAI-CAND-REM-15"]){
      const c=corpus.cases.find(c=>c.caseID===caseID)!;assert.ok(c);
      const original=bindCustomerCase(c);const followup:Record<string,string>=explicitBoundaryFollowup(c);
      for(const key of Object.keys(followup))if(original.input?.[key as "issueDate"|"documentNumber"|"dueDate"])delete followup[key];
      const bound=bindCustomerCase(c,followup);assert.ok(bound.input);
      assert.deepEqual(bound.issues,[]);assert.deepEqual(bound.unmappedFacts,[]);
      assert.deepEqual(missingCustomerFields(bound.input),[]);assert.equal(unsupportedCustomerInput(bound.input),false);
      const input={...bound.input,idempotencyKey:randomUUID()};
      let observation:unknown;
      if(caseID==="CAI-CAND-QUO-14"){
        // Only no-outbound fixture reservations are removed in finally.
        // Real billed/provider-attempt records are never part of this set.
        const values=Array.from({length:beforeUsage.workspaceDailyLimit},()=>{
          const id=randomUUID();fakeIds.push(id);
          return{id,workspaceId:actor.workspaceId,actorId:actor.identityId,idempotencyKey:randomUUID(),
            inputHash:hashAI({negativeQuotaFixture:id}),task:"quotation",status:"manual_fallback",
            promptVersion:`${customerPromptVersion}/${customerNoticeVersion}`,budgetReserved:true,
            preview:customerPreview(id,input,"manual_fallback",null,hashAI(input),0,null,
              ["Synthetic quota fixture; no provider request or generation."]),providerRuns:[],providerCalls:0,
            failureCode:"CONTROLLED_NO_OUTBOUND_QUOTA_FIXTURE"};
        });
        await db.insert(valoAIDrafts).values(values);
        const atLimit=await customerAIUsage(actor);
        assert.ok(atLimit.enabled&&atLimit.globalAvailable&&atLimit.workspaceUsed>=atLimit.workspaceDailyLimit);
        observation={workspaceLimit:atLimit.workspaceDailyLimit,workspaceReservations:atLimit.workspaceUsed,
          actualConfiguredLimitReached:true,aiEnabledBeforeDenial:true,temporaryNoOutboundReservations:fakeIds.length};
      }else{
        await db.insert(valoSafetySwitches).values({key:flagKey,enabled:false,
          reason:"Isolated synthetic source kill-switch evaluation",actorId:marker})
          .onConflictDoUpdate({target:valoSafetySwitches.key,set:{enabled:false,
            reason:"Isolated synthetic source kill-switch evaluation",actorId:marker,updatedAt:new Date()}});
        installedFlag=true;
        const paused=await customerAIUsage(actor);
        assert.equal(paused.enabled,false);assert.ok(paused.workspaceUsed<paused.workspaceDailyLimit&&paused.globalAvailable);
        observation={workspaceScopedPause:true,globalSwitchUntouched:true,quotaAvailable:true,actualDisabledStateObserved:true};
      }
      const preview=await createCustomerAIDraft(actor,input,forbiddenAdapter);negativeIds.push(preview.id);
      assert.equal(preview.status,"manual_fallback");assert.equal(calls,0);
      const[stored]=await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.id,preview.id));
      assert.ok(stored);assert.equal(stored.budgetReserved,false);assert.equal(stored.providerCalls,0);
      assert.deepEqual(stored.providerRuns,[]);assert.equal(stored.failureCode,"AI_DISABLED_OR_DAILY_QUOTA");
      const manual=await preserveManual(caseID==="CAI-CAND-QUO-14"?"quota":"kill-switch");
      records.push({caseID,caseHash:hashAI(c),originalInputHash:original.inputHash,
        originalMissing:original.missing,followup:bound.followup,mappedInputHash:bound.inputHash,
        status:"control_pass",targetBoundaryReached:true,actualOutboundCalls:0,observation,manual});
      if(caseID==="CAI-CAND-QUO-14"){
        await db.delete(valoAIDrafts).where(and(inArray(valoAIDrafts.id,fakeIds),eq(valoAIDrafts.providerCalls,0),
          sql`jsonb_array_length(${valoAIDrafts.providerRuns})=0`));
        assert.ok((await customerAIUsage(actor)).workspaceUsed<beforeUsage.workspaceDailyLimit);
      }
    }
  }finally{
    const all=[...fakeIds,...negativeIds];
    if(all.length)await db.delete(valoAIDrafts).where(and(inArray(valoAIDrafts.id,all),
      eq(valoAIDrafts.providerCalls,0),sql`jsonb_array_length(${valoAIDrafts.providerRuns})=0`));
    if(installedFlag){
      const owned=and(eq(valoSafetySwitches.key,flagKey),eq(valoSafetySwitches.actorId,marker));
      if(oldFlag)await db.update(valoSafetySwitches).set({enabled:oldFlag.enabled,reason:oldFlag.reason,
        actorId:oldFlag.actorId,updatedAt:oldFlag.updatedAt}).where(owned);
      else await db.delete(valoSafetySwitches).where(owned);
    }
    const remaining=all.length?await db.select({id:valoAIDrafts.id}).from(valoAIDrafts).where(inArray(valoAIDrafts.id,all)):[];
    const realAfter=await actualRows();
    for(const before of realBefore)assert.ok(realAfter.some(after=>hashAI(after)===hashAI(before)),"Actual provider usage history changed");
    assert.equal(remaining.length,0);
    const after=await customerAIUsage(actor);assert.equal(after.enabled,beforeUsage.enabled);
    assert.ok(after.workspaceUsed>=beforeUsage.workspaceUsed);
    const[globalAfter]=await db.select().from(valoSafetySwitches).where(eq(valoSafetySwitches.key,"customer_ai"));
    assert.equal(hashAI(globalAfter??null),hashAI(globalBefore??null));
    cleanupSucceeded=true;
  }
  assert.equal(records.length,2);
  const codePaths=["artifacts/api-server/src/lib/valo-customer-ai.ts","artifacts/api-server/src/lib/valo-customer-ai-domain.ts",
    "artifacts/api-server/src/lib/valo-customer-case-binding.ts","artifacts/api-server/src/scripts/customer-native-boundaries.ts"];
  const codeHashes=Object.fromEntries(await Promise.all(codePaths.map(async p=>[p,sha256(await readFile(resolve(root,p)))])));
  await writeFile(resolve(out,"results.json"),JSON.stringify({executedAt:new Date().toISOString(),records,codeHashes,
    actualOutboundCalls:calls,identitiesCreated:0,quotaLimitsChanged:false,cleanupSucceeded,realProviderHistoryPreserved:true,
    source80Accepted:false,customer60Accepted:false,editorial60Accepted:false,
    scope:"Actual development database denial boundaries and private document/download services; controlled fixtures, not provider-quality cases or managed-browser verification."},null,2)+"\n");
  console.log(JSON.stringify({nativeCaseBoundariesPassed:records.length,actualOutboundCalls:calls,cleanupSucceeded,formalAcceptance:false}));
}
main().catch(()=>{console.error("Native customer boundary proof stopped; no pass inferred.");process.exitCode=1;}).finally(()=>pool.end());
