import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {logger} from "./logger";
import {withPrivacyCaseLock,ErasureLockBusyError} from "./valo-erasure-lock";
import {and,eq,ne,sql,lte,asc} from "drizzle-orm";
import {db,valoPrivacyCases,valoPrivacyTombstones,valoPrivacyEvents,valoWorkspaces,valoMemberships,valoExportJobs,
  valoExportObjects} from "@workspace/db";
import {ActOnStaffPrivacyCaseBody} from "@workspace/api-zod";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
import {deletePrivateFile} from "./valo-private-storage";
import {privacyKey,privacySigner} from "./valo-privacy-keys";
import {quotaSubjectHash} from "./valo-quota";
import {assertErasureObjectScope,inventoryHasher,signErasureSeal,verifyErasureSeal,erasureSealHash,
  assertSealedInventory,startReplay,signReplayState,verifyReplayState,type ErasureSeal,type ReplayState} from "./valo-erasure-seal";
import {ValoProblem} from "./valo-problem";
import {cancelUnsentDisputeWork} from "./valo-dispute-actions";
import {assertPrivacyVersion} from "./valo-privacy-state";
import {readPrivacyCase,requirePrivacyStaff,privacyChange,privacyDetail,type PrivacyStaffActor,type PrivacyRow} from "./valo-privacy";

const phases=[
  "valo_reminder_outbox","valo_tasks","valo_assessments","valo_ai_drafts",
  "valo_export_requests","valo_file_assets","valo_export_objects","valo_export_jobs",
  "valo_document_revisions","valo_documents","valo_profile_versions","valo_reminder_preferences",
  "purchase_notifications","support_content","privacy_messages","privacy_content","dispute_work",
] as const;
const removedMessage="[Private content removed by verified workspace erasure]";
const scope="development-application-content-erasure-v2";
type Input=ReturnType<typeof ActOnStaffPrivacyCaseBody.parse>;
type DeleteObject=(key:string)=>Promise<void>;
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Tombstone=typeof valoPrivacyTombstones.$inferSelect;

// Lock connections never consume the shared data pool. Bounded acquisition and
// idle exit prevent hung requests/tests; worker shutdown explicitly drains it.
let lockPool:Pool|undefined;
export async function closePrivacyErasureLocks(){const closing=lockPool;lockPool=undefined;await closing?.end();}
async function withErasureLock<T>(caseId:string,fn:()=>Promise<T>){
  assertDevelopmentRuntime();
  if(!lockPool){
    lockPool=new Pool({connectionString:process.env.DATABASE_URL,max:2,
      connectionTimeoutMillis:1000,idleTimeoutMillis:10000,allowExitOnIdle:true});
    lockPool.on("error",()=>logger.error({event:"privacy.lock_connection_failed"}));
  }
  try{return await withPrivacyCaseLock(lockPool,caseId,fn);}catch(error){
    if(error instanceof ErasureLockBusyError)throw new ValoProblem(409,"This erasure/recovery batch is already running. Reload its recorded progress.");
    throw error;
  }
}
async function sealOf(tx:Tx,t:Tombstone){
  const version=(t.erasureSeal as {keyVersion?:unknown}|null)?.keyVersion;
  if(typeof version!=="string")throw Error("ERASURE_SEAL_INVALID");
  return verifyErasureSeal(t.erasureSeal,{caseId:t.caseId,workspaceId:t.workspaceId,
    identityHash:t.identityHash,identityKeyVersion:t.keyVersion},await privacyKey(tx,version));
}
async function progressOf(tx:Tx,raw:unknown,seal:ErasureSeal){
  const version=(raw as {keyVersion?:unknown}|null)?.keyVersion;
  if(typeof version!=="string")throw Error("ERASURE_REPLAY_STATE_INVALID");
  return verifyReplayState(raw,seal,phases.length,await privacyKey(tx,version));
}
async function signSeal(tx:Tx,input:Omit<ErasureSeal,"keyVersion"|"mac">){
  return signErasureSeal(input,await privacySigner(tx));
}
async function readTombstone(tx:Tx,caseId:string){
  const[t]=await tx.select().from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.caseId,caseId)).for("update");
  if(!t)throw new ValoProblem(404,"A retained signed deletion journal is required.");
  return {t,seal:await sealOf(tx,t)};
}
/** Full exact inventory verification uses bounded memory. It precedes object
 * dispatch, and the DB trigger forbids key insert/update/delete after sealing. */
async function inventory(tx:Tx,t:Tombstone){
  const h=inventoryHasher(t.workspaceId);let cursor="";
  for(;;){
    const page=await tx.execute<{workspace_id:string;object_key:string}>(sql`SELECT workspace_id,object_key
      FROM valo_privacy_erasure_objects WHERE case_id=${t.caseId}::uuid AND object_key COLLATE "C">${cursor}
      ORDER BY object_key COLLATE "C" LIMIT 250`);
    for(const row of page.rows){
      if(row.workspace_id!==t.workspaceId)throw Error("ERASURE_INVENTORY_WORKSPACE_CHANGED");
      h.add(row.object_key);cursor=row.object_key;
    }
    if(page.rows.length<250)return h.finish();
  }
}
async function verifyInventory(tx:Tx,t:Tombstone,seal:ErasureSeal){
  if(!seal.inventoryHash)throw new ValoProblem(409,"The exact erasure inventory has not been sealed.");
  const actual=await inventory(tx,t);
  assertSealedInventory(seal,actual);
}
function assertProcessing(row:PrivacyRow,actor:PrivacyStaffActor,version?:number){
  if(version!==undefined)assertPrivacyVersion(row.version,version);
  if(row.kind!=="deletion"||!row.verifiedAt||row.assignedIdentityId!==actor.identityId)
    throw new ValoProblem(403,"A verified deletion request assigned to this privacy operator is required.");
  if(!["assigned","in_progress","failed","partially_fulfilled"].includes(row.status))
    throw new ValoProblem(409,"The case is held or unavailable. Explicitly release its hold before processing.");
}
export async function holdUnsentPrivacyNotifications(tx:Tx,workspaceId:string){
  return tx.execute(sql`UPDATE valo_purchase_outbox SET status='held_privacy_erasure'
    WHERE ctid IN (SELECT ctid FROM valo_purchase_outbox WHERE workspace_id=${workspaceId}::uuid
      AND status IN ('awaiting_email_configuration','pending','retry') LIMIT 100)`);
}
async function eraseSection(tx:Tx,workspaceId:string,section:typeof phases[number],currentCaseId:string){
  if(section==="dispute_work")return cancelUnsentDisputeWork(tx,workspaceId);
  if(section==="privacy_messages")return tx.execute(sql`DELETE FROM valo_privacy_messages WHERE ctid IN
    (SELECT ctid FROM valo_privacy_messages WHERE workspace_id=${workspaceId}::uuid LIMIT 100)`);
  if(section==="purchase_notifications")return holdUnsentPrivacyNotifications(tx,workspaceId);
  if(section==="support_content")return tx.execute(sql`UPDATE valo_support_tickets SET
    scope=${removedMessage},contact_email='erased@invalid'
    WHERE ctid IN (SELECT ctid FROM valo_support_tickets WHERE workspace_id=${workspaceId}::uuid
      AND (scope<>${removedMessage} OR contact_email<>'erased@invalid') LIMIT 100)`);
  if(section==="privacy_content"){
    // Preserve the signed historical phase indices. Replays also remove saved
    // metadata added after the original erasure engine was introduced.
    const saved=await tx.execute(sql`DELETE FROM valo_saved_templates WHERE ctid IN
      (SELECT ctid FROM valo_saved_templates WHERE workspace_id=${workspaceId}::uuid LIMIT 100)`);
    if(saved.rowCount)return saved;
    const rows=await tx.select().from(valoPrivacyCases).where(and(eq(valoPrivacyCases.workspaceId,workspaceId),
      ne(valoPrivacyCases.id,currentCaseId),sql`(${valoPrivacyCases.message}<>${removedMessage} OR ${valoPrivacyCases.resultJson} IS NOT NULL)`)).limit(100).for("update");
    for(const target of rows){
      const checked=await readPrivacyCase(tx,target.id);
      await privacyChange(tx,checked,{identityId:"service:privacy-erasure",type:"worker"},"private_content_removed",
        "Verified workspace erasure removed request text and prepared data; historical signed audit evidence is retained.",{
          message:removedMessage,resultJson:null,resultScope:"Private prepared content removed by verified workspace erasure.",
        });
    }
    return{rowCount:rows.length};
  }
  if(section==="valo_ai_drafts")return tx.execute(sql`UPDATE valo_ai_drafts SET preview='{}'::jsonb,plan=NULL,
    accepted_document_id=NULL,status='privacy_erased',updated_at=now()
    WHERE ctid IN (SELECT ctid FROM valo_ai_drafts WHERE workspace_id=${workspaceId}::uuid
    AND status<>'privacy_erased' LIMIT 100)`);
  const table=sql.identifier(section);
  return tx.execute(sql`DELETE FROM ${table} WHERE ctid IN
    (SELECT ctid FROM ${table} WHERE workspace_id=${workspaceId}::uuid LIMIT 100)`);
}
async function recordObjectOutcome(caseId:string,workspaceId:string,key:string,deleted:boolean){
  // An already-dispatched result remains true after a role revocation/hold.
  // Recording it does not authorize the next deletion or alter case status.
  const r=await db.execute(sql`UPDATE valo_privacy_erasure_objects SET status=${deleted?"deleted":"failed"},
    attempts=attempts+1,updated_at=now() WHERE case_id=${caseId}::uuid
    AND workspace_id=${workspaceId}::uuid AND object_key=${key}`);
  if(r.rowCount!==1)throw Error("ERASURE_OUTCOME_JOURNAL_UNAVAILABLE");
}
export async function processPrivacyErasure(actor:PrivacyStaffActor,id:string,input:Input,remove:DeleteObject=deletePrivateFile){
  return withErasureLock(id,()=>processErasure(actor,id,input,remove));
}
async function processErasure(actor:PrivacyStaffActor,id:string,input:Input,remove:DeleteObject){
  const start=await db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);let row=await readPrivacyCase(tx,id);
    assertProcessing(row,actor,input.expectedVersion);await privacySigner(tx);
    if(input.acknowledgement!==true)throw new ValoProblem(422,"Explicitly acknowledge irreversible application-content erasure and retained exclusions.");
    const[w]=await tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.id,row.workspaceId)).for("update");
    if(!w||!/^(synthetic-|privacy-fixture-)/.test(w.ownerIdentityId))
      throw new ValoProblem(409,"Only explicitly synthetic development workspaces are eligible. Production/provider deletion is not enabled.");
    if(row.erasurePhase==="not_started"){
      if(input.action!=="start_erasure")throw new ValoProblem(409,"Begin the acknowledged erasure first.");
      const signer=await privacySigner(tx),identityKeyVersion=signer.version,
        identityHash=quotaSubjectHash(signer.key,"user",w.ownerIdentityId);
      const erasureSeal=signErasureSeal({version:2,caseId:id,workspaceId:row.workspaceId,identityHash,identityKeyVersion,
        scope,synthetic:true,inventoryHash:null,inventoryCount:0,completedEventHash:null},signer);
      await tx.insert(valoPrivacyTombstones).values({id:randomUUID(),workspaceId:row.workspaceId,caseId:id,
        identityHash,keyVersion:identityKeyVersion,phase:scope,erasureSeal});
      await tx.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.workspaceId,row.workspaceId));
      row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"erasure_quarantined",input.reason,{
        status:"in_progress",erasurePhase:"quarantined",resultJson:null,
        resultScope:"Development application erasure started; access revoked. Financial, support/privacy, audit, backup and external-provider scope remains unfulfilled.",
        steps:row.steps.map(s=>s.system==="application"||s.system==="private_files"?
          {...s,status:"running",detail:"Resumable synthetic erasure; no complete account/provider fulfilment is claimed."}:s)});
    }else{
      if(input.action!=="resume_erasure")throw new ValoProblem(409,"Resume the existing erasure with its current version.");
      await readTombstone(tx,id); // Missing historical keys or unsigned journals hold closed.
    }
    return{workspaceId:row.workspaceId,version:row.version,phase:row.erasurePhase};
  });
  if(start.phase==="application_erased")return db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);const row=await readPrivacyCase(tx,id);assertProcessing(row,actor,start.version);
    return privacyDetail(tx,row);
  });
  if(start.phase==="objects"){
    const {expected,pending}=await db.transaction(async tx=>{
      await requirePrivacyStaff(tx,actor);assertProcessing(await readPrivacyCase(tx,id),actor,start.version);
      const {t,seal}=await readTombstone(tx,id);await privacySigner(tx);await verifyInventory(tx,t,seal);
      const pending=await tx.execute<{object_key:string}>(sql`SELECT object_key FROM valo_privacy_erasure_objects
        WHERE case_id=${id}::uuid AND status<>'deleted' ORDER BY object_key COLLATE "C" LIMIT 10`);
      return{expected:erasureSealHash(seal),pending};
    });
    for(const object of pending.rows){
      // Recheck before EACH call, outside the previous object's network wait.
      await db.transaction(async tx=>{
        await requirePrivacyStaff(tx,actor);assertProcessing(await readPrivacyCase(tx,id),actor,start.version);
        const {seal}=await readTombstone(tx,id);await privacySigner(tx);
        if(erasureSealHash(seal)!==expected)throw Error("ERASURE_SEAL_CHANGED");
        assertErasureObjectScope(start.workspaceId,object.object_key);
      });
      let deleted=false;try{await remove(object.object_key);deleted=true;}catch{/* Keep an actual retryable failure. */}
      await recordObjectOutcome(id,start.workspaceId,object.object_key,deleted);
    }
  }
  return db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);let row=await readPrivacyCase(tx,id);assertProcessing(row,actor,start.version);
    const journal=await readTombstone(tx,id);await privacySigner(tx);
    let next=start.phase,detail="Private-object deletion remains pending; failed keys are retryable.";
    if(start.phase==="quarantined"){
      await tx.update(valoExportJobs).set({status:"failed",queueId:randomUUID(),errorCode:"PRIVACY_ERASURE",
        updatedAt:new Date()}).where(eq(valoExportJobs.workspaceId,row.workspaceId));
      await tx.update(valoExportObjects).set({state:"cleanup"}).where(eq(valoExportObjects.workspaceId,row.workspaceId));
      await tx.execute(sql`UPDATE valo_reminder_preferences SET enabled=false WHERE workspace_id=${row.workspaceId}::uuid`);
      await tx.execute(sql`INSERT INTO valo_privacy_erasure_objects(workspace_id,case_id,object_key)
        SELECT workspace_id,${row.id}::uuid,object_key FROM valo_export_objects WHERE workspace_id=${row.workspaceId}::uuid
        UNION SELECT workspace_id,${row.id}::uuid,object_key FROM valo_file_assets WHERE workspace_id=${row.workspaceId}::uuid
        ON CONFLICT DO NOTHING`);
      const exact=await inventory(tx,journal.t);
      await tx.update(valoPrivacyTombstones).set({erasureSeal:await signSeal(tx,{...journal.seal,
        inventoryHash:exact.hash,inventoryCount:exact.count})}).where(eq(valoPrivacyTombstones.id,journal.t.id));
      next="objects";detail="Export generations fenced; the complete exact object inventory is signed and immutable.";
    }else if(start.phase==="objects"){
      const count=await tx.execute<{remaining:number}>(sql`SELECT count(*)::int AS remaining FROM valo_privacy_erasure_objects
        WHERE case_id=${id}::uuid AND status<>'deleted'`);
      if(count.rows[0]?.remaining===0){next=phases[0];detail="Captured delete calls acknowledged. Signed keys remain scheduled for repeated late-upload cleanup.";}
    }else if((phases as readonly string[]).includes(start.phase)){
      const result=await eraseSection(tx,row.workspaceId,start.phase as typeof phases[number],row.id);
      if((result.rowCount??0)<100)next=phases[phases.indexOf(start.phase as typeof phases[number])+1]??"application_erased";
      detail=`Removed ${result.rowCount??0} rows from this application section; retained/external exclusions remain.`;
    }else throw new ValoProblem(409,"Unknown erasure phase; processing is held.");
    const done=next==="application_erased";
    if(done)await tx.update(valoWorkspaces).set({profileRevision:0}).where(eq(valoWorkspaces.id,row.workspaceId));
    row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"erasure_batch_recorded",input.reason,{
      ...(start.phase==="privacy_content"?{message:removedMessage,resultJson:null}:{}),
      erasurePhase:next,status:done?"partially_fulfilled":"in_progress",
      resultScope:done?"Scoped synthetic application rows erased; captured object deletes acknowledged with durable repeated late-write cleanup. V2 removes support/contact and privacy prepared-result copies. Financial records, minimal case references, signed audit text, managed identity, backups and external-provider/write uncertainty remain retained or held; this is not complete account deletion.":row.resultScope,
      steps:row.steps.map(s=>s.system==="application"?{...s,status:done?"confirmed":"running",detail}:
        s.system==="private_files"?{...s,status:next==="objects"||next==="quarantined"?"running":"held",
          detail:"Captured deletions are recorded; signed object keys outlive job rows for repeated cleanup. Future completion of an interrupted upload is not claimed impossible."}:
        s.system==="identity_verification"?s:{...s,status:"held",detail:"Retained/external scope has not been fulfilled; no legal-retention duration or provider deletion is asserted."})});
    if(done)await tx.update(valoPrivacyTombstones).set({
      erasureSeal:await signSeal(tx,{...journal.seal,completedEventHash:row.lastEventHash}),replayState:null,nextReplayAt:new Date(),
    }).where(eq(valoPrivacyTombstones.id,journal.t.id));
    return privacyDetail(tx,row);
  });
}
async function replayReady(tx:Tx,caseId:string,verifyObjects=false){
  await privacySigner(tx); // A valid historical proof cannot bypass a broken current signer.
  const row=await readPrivacyCase(tx,caseId),{t,seal}=await readTombstone(tx,caseId);
  if(row.workspaceId!==t.workspaceId||row.kind!=="deletion"||!row.verifiedAt||row.erasurePhase!=="application_erased"||
    !["partially_fulfilled","fulfilled"].includes(row.status)||!seal.completedEventHash||!seal.inventoryHash||
    !/^(synthetic-|privacy-fixture-)/.test(row.requesterIdentityId)||
    quotaSubjectHash(await privacyKey(tx,seal.identityKeyVersion),"user",row.requesterIdentityId)!==seal.identityHash)
    throw new ValoProblem(409,"Only an authenticated completed synthetic scope may replay. Unfinished or held cases require privacy operations.");
  const[event]=await tx.select({id:valoPrivacyEvents.id}).from(valoPrivacyEvents).where(and(
    eq(valoPrivacyEvents.caseId,caseId),eq(valoPrivacyEvents.workspaceId,t.workspaceId),
    eq(valoPrivacyEvents.eventHash,seal.completedEventHash),eq(valoPrivacyEvents.action,"erasure_batch_recorded"))).limit(1);
  if(!event)throw new ValoProblem(409,"The completion receipt is absent from the authenticated case history.");
  if(verifyObjects)await verifyInventory(tx,t,seal);
  return{row,t,seal};
}
async function persistReplay(t:Tombstone,input:Omit<ReplayState,"keyVersion"|"mac">,done=false){
  return db.transaction(async tx=>{
    const state=signReplayState(input,await privacySigner(tx));
    await tx.update(valoPrivacyTombstones).set({replayState:state,
      nextReplayAt:new Date(Date.now()+(done?3_600_000:0)),updatedAt:new Date()}).where(eq(valoPrivacyTombstones.id,t.id));
    return state;
  });
}
async function replay(caseId:string,mode:ReplayState["mode"],remove:DeleteObject){
  let {t,seal,state,candidates}=await db.transaction(async tx=>{
    const ready=await replayReady(tx,caseId);
    let state=ready.t.replayState?await progressOf(tx,ready.t.replayState,ready.seal):null;
    if(state&&state.phase!=="done"&&state.mode!==mode)throw new ValoProblem(409,"Another recovery mode has unfinished recorded progress.");
    if(!state||state.phase==="done")state=startReplay(ready.seal,mode,await privacySigner(tx));
    let candidates:{object_key:string}[]=[];
    if(state.phase==="objects"){
      await verifyInventory(tx,ready.t,ready.seal);
      const batch=await tx.execute<{object_key:string}>(sql`SELECT object_key FROM valo_privacy_erasure_objects
        WHERE case_id=${caseId}::uuid AND object_key COLLATE "C">${state.cursor} ORDER BY object_key COLLATE "C" LIMIT 10`);
      candidates=batch.rows;
    }
    await tx.update(valoPrivacyTombstones).set({replayState:state}).where(eq(valoPrivacyTombstones.id,ready.t.id));
    await tx.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.workspaceId,ready.t.workspaceId));
    return{...ready,state,candidates};
  });
  let deleted=0,failed=0,applicationRowsRemoved=0;
  if(state.phase==="objects"){
    // These exact keys were captured under the same tombstone lock as the
    // authenticated inventory; no later untrusted candidate query is allowed.
    for(const object of candidates){
      await db.transaction(async tx=>{
        const now=await replayReady(tx,caseId);
        if(erasureSealHash(now.seal)!==state.sealHash)throw Error("ERASURE_SEAL_CHANGED");
        assertErasureObjectScope(t.workspaceId,object.object_key);
      });
      let ok=false;try{await remove(object.object_key);ok=true;deleted++;}catch{failed++;}
      await recordObjectOutcome(caseId,t.workspaceId,object.object_key,ok);
      if(!ok)return{deleted,failed,remaining:true,applicationRowsRemoved,externalSystemsFulfilled:false};
      state=await persistReplay(t,{...state,cursor:object.object_key});
    }
    if(candidates.length<10){
      state=await persistReplay(t,{...state,phase:mode==="application"?0:"done"},mode==="objects");
    }
    return{deleted,failed,remaining:state.phase!=="done",applicationRowsRemoved,externalSystemsFulfilled:false};
  }
  if(typeof state.phase==="number"){
    const phase=state.phase;
    await db.transaction(async tx=>{
      const now=await replayReady(tx,caseId);
      const persisted=await progressOf(tx,now.t.replayState,now.seal);
      if(persisted.mac!==state.mac)throw new ValoProblem(409,"Recovery progress changed.");
      // One bounded application section; no object inventory rescan/redelete.
      const result=await eraseSection(tx,t.workspaceId,phases[phase]!,caseId);applicationRowsRemoved=result.rowCount??0;
      if(applicationRowsRemoved<100)state=signReplayState({...state,phase:phase+1===phases.length?"done":phase+1},await privacySigner(tx));
      await tx.update(valoPrivacyTombstones).set({replayState:state,
        nextReplayAt:new Date(Date.now()+(state.phase==="done"?3_600_000:0))}).where(eq(valoPrivacyTombstones.id,t.id));
      if(state.phase==="done")await tx.update(valoWorkspaces).set({profileRevision:0}).where(eq(valoWorkspaces.id,t.workspaceId));
    });
  }
  return{deleted,failed,remaining:state.phase!=="done",applicationRowsRemoved,externalSystemsFulfilled:false};
}
export async function replayErasureObjects(caseId:string,remove:DeleteObject=deletePrivateFile){
  return withErasureLock(caseId,()=>replay(caseId,"objects",remove));
}
export async function replayErasedApplication(caseId:string,remove:DeleteObject=deletePrivateFile){
  return withErasureLock(caseId,()=>replay(caseId,"application",remove));
}
/** Existing export-worker reconciliation calls this bounded service. Tombstone
 * keys survive export-row deletion and are revisited even after process death. */
export async function reconcileErasedObjects(remove:DeleteObject=deletePrivateFile,caseId?:string){
  assertDevelopmentRuntime();
  const due=await db.select().from(valoPrivacyTombstones).where(and(lte(valoPrivacyTombstones.nextReplayAt,new Date()),
    caseId?eq(valoPrivacyTombstones.caseId,caseId):undefined))
    .orderBy(asc(valoPrivacyTombstones.nextReplayAt),asc(valoPrivacyTombstones.id)).limit(5);
  let cleaned=0,failed=0,held=0;
  for(const t of due){
    try{
      await db.transaction(async tx=>{
        const seal=await sealOf(tx,t);
        if(!seal.completedEventHash)throw Error("ERASURE_INCOMPLETE");
        if(t.replayState){const s=await progressOf(tx,t.replayState,seal);if(s.mode==="application"&&s.phase!=="done")throw Error("APPLICATION_REPLAY_ACTIVE");}
      });
      const result=await replayErasureObjects(t.caseId,remove);cleaned+=result.deleted;failed+=result.failed;
      if(result.failed)await db.update(valoPrivacyTombstones).set({nextReplayAt:new Date(Date.now()+60_000)})
        .where(eq(valoPrivacyTombstones.id,t.id));
    }catch{
      held++;
      // Held legacy/corrupt cases cannot starve the bounded queue forever.
      await db.update(valoPrivacyTombstones).set({nextReplayAt:new Date(Date.now()+60_000)})
        .where(eq(valoPrivacyTombstones.id,t.id));
    } // Hold/corruption/missing keys never authorize a storage call.
  }
  return{cleaned,failed,held};
}
