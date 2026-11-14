import {randomUUID} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import {db,valoPrivacyTombstones,valoWorkspaces,valoMemberships,valoExportJobs,
  valoExportObjects,valoFileAssets} from "@workspace/db";
import {ActOnStaffPrivacyCaseBody} from "@workspace/api-zod";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
import {deletePrivateFile} from "./valo-private-storage";
import {quotaSubjectHash} from "./valo-quota";
import {privacyKey,privacySigner} from "./valo-privacy-keys";
import {ValoProblem} from "./valo-problem";
import {assertPrivacyVersion} from "./valo-privacy-state";
import {readPrivacyCase,requirePrivacyStaff,privacyChange,privacyDetail,type PrivacyStaffActor} from "./valo-privacy";

// Static reviewed order: remove FK children before parents. Financial records,
// support/privacy requests and security/audit evidence are explicit exclusions.
// These exclusions are pending retention review, NOT a claim of statutory holds.
const phases=[
  "valo_reminder_outbox","valo_tasks","valo_assessments","valo_ai_drafts",
  "valo_export_requests","valo_file_assets","valo_export_objects","valo_export_jobs",
  "valo_document_revisions","valo_documents","valo_profile_versions","valo_reminder_preferences",
] as const;
const scope="development-application-content-erasure-v1";
type Input=ReturnType<typeof ActOnStaffPrivacyCaseBody.parse>;
type DeleteObject=(key:string)=>Promise<void>;
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
function assertObjectScope(workspaceId:string,key:string){
  if(!key.startsWith(`valo/development/${workspaceId}/`)||
    !/^valo\/development\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(docx|pdf)$/.test(key))
    throw new ValoProblem(409,"Private-object deletion scope could not be verified.");
}
async function eraseSection(tx:Tx,workspaceId:string,section:typeof phases[number]){
  if(section==="valo_ai_drafts"){
    // Usage/cost/quota receipts must survive content deletion. Never turn an
    // already incurred provider call into a free call by removing its ledger.
    return tx.execute(sql`UPDATE valo_ai_drafts SET preview='{}'::jsonb,plan=NULL,
      accepted_document_id=NULL,status='privacy_erased',updated_at=now()
      WHERE ctid IN (SELECT ctid FROM valo_ai_drafts WHERE workspace_id=${workspaceId}::uuid
      AND status<>'privacy_erased' LIMIT 100)`);
  }
  const table=sql.identifier(section);
  return tx.execute(sql`DELETE FROM ${table} WHERE ctid IN
    (SELECT ctid FROM ${table} WHERE workspace_id=${workspaceId}::uuid LIMIT 100)`);
}

/** Development capability only. A verified assigned request plus explicit
 * acknowledgement is necessary. This does not enable production deletion or
 * assert that any provider has fulfilled an external erasure request. */
export async function processPrivacyErasure(actor:PrivacyStaffActor,id:string,input:Input,
  remove:DeleteObject=deletePrivateFile){
  assertDevelopmentRuntime();
  const start=await db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);
    let row=await readPrivacyCase(tx,id);
    assertPrivacyVersion(row.version,input.expectedVersion);
    if(row.kind!=="deletion"||!row.verifiedAt||row.assignedIdentityId!==actor.identityId)
      throw new ValoProblem(403,"A verified deletion request assigned to this privacy operator is required.");
    if(input.acknowledgement!==true)throw new ValoProblem(422,"Explicitly acknowledge irreversible application-content erasure and the retained exclusions.");
    if(!["assigned","in_progress","failed","partially_fulfilled"].includes(row.status))
      throw new ValoProblem(409,"Resolve the recorded hold or request state before erasure.");
    const[w]=await tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.id,row.workspaceId)).for("update");
    if(!w||! /^(synthetic-|privacy-fixture-)/.test(w.ownerIdentityId))
      throw new ValoProblem(409,"This development erasure capability accepts explicitly synthetic workspaces only. Production policy and provider deletion are not enabled.");
    if(row.erasurePhase==="not_started"){
      if(input.action!=="start_erasure")throw new ValoProblem(409,"Begin the explicitly acknowledged erasure first.");
      const signer=await privacySigner(tx);
      await tx.insert(valoPrivacyTombstones).values({id:randomUUID(),workspaceId:row.workspaceId,caseId:row.id,
        identityHash:quotaSubjectHash(signer.key,"user",w.ownerIdentityId),keyVersion:signer.version,phase:scope});
      // Revocations serialize against every membership-authorized commit.
      await tx.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.workspaceId,row.workspaceId));
      row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"erasure_quarantined",input.reason,{
        status:"in_progress",erasurePhase:"quarantined",resultJson:null,
        resultScope:"Application-content erasure started. Access is revoked. Financial, support/privacy and audit records are retained pending policy review; external providers are not erased.",
        steps:row.steps.map(s=>s.system==="application"||s.system==="private_files"?
          {...s,status:"running",detail:"Resumable development erasure; no whole-account fulfilment is claimed."}:s)});
    }else if(input.action!=="resume_erasure")throw new ValoProblem(409,"Erasure already began. Resume with the current request version.");
    return {workspaceId:row.workspaceId,version:row.version,phase:row.erasurePhase};
  });
  // Do not hold a transaction over object-store I/O. The case lock below fences
  // competing completions; delete is idempotent, and ledger keys survive purge.
  if(start.phase==="objects"){
    const pending=await db.execute<{object_key:string}>(sql`SELECT object_key FROM valo_privacy_erasure_objects
      WHERE case_id=${id}::uuid AND workspace_id=${start.workspaceId}::uuid AND status<>'deleted'
      ORDER BY object_key LIMIT 10`);
    for(const object of pending.rows){
      let deleted=false;
      try{assertObjectScope(start.workspaceId,object.object_key);await remove(object.object_key);deleted=true;}catch{/* Safely retry the same key; never invent success. */}
      await db.execute(sql`UPDATE valo_privacy_erasure_objects SET status=${deleted?"deleted":"failed"},
        attempts=attempts+1,updated_at=now() WHERE case_id=${id}::uuid
        AND workspace_id=${start.workspaceId}::uuid AND object_key=${object.object_key}`);
    }
  }
  return db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);let row=await readPrivacyCase(tx,id);
    assertPrivacyVersion(row.version,start.version);
    if(row.assignedIdentityId!==actor.identityId)throw new ValoProblem(403,"Assignment changed; no completion was recorded.");
    let next=start.phase,detail="Private-object deletion remains pending. Failed keys are retryable; no affected bytes are claimed deleted.";
    if(start.phase==="quarantined"){
      // Membership revocation was committed in the preceding transaction.
      // Never wait on job locks while holding exclusive membership locks.
      await tx.update(valoExportJobs).set({status:"failed",queueId:randomUUID(),errorCode:"PRIVACY_ERASURE",
        updatedAt:new Date()}).where(eq(valoExportJobs.workspaceId,row.workspaceId));
      await tx.update(valoExportObjects).set({state:"cleanup"}).where(eq(valoExportObjects.workspaceId,row.workspaceId));
      await tx.execute(sql`UPDATE valo_reminder_preferences SET enabled=false WHERE workspace_id=${row.workspaceId}::uuid`);
      await tx.execute(sql`INSERT INTO valo_privacy_erasure_objects(workspace_id,case_id,object_key)
        SELECT workspace_id,${row.id}::uuid,object_key FROM valo_export_objects WHERE workspace_id=${row.workspaceId}::uuid
        UNION SELECT workspace_id,${row.id}::uuid,object_key FROM valo_file_assets WHERE workspace_id=${row.workspaceId}::uuid
        ON CONFLICT DO NOTHING`);
      next="objects";detail="Pending export generations were fenced and reminders disabled. Private-object keys were durably captured after access revocation.";
    }else if(start.phase==="objects"){
      const count=await tx.execute<{remaining:number}>(sql`SELECT count(*)::int AS remaining FROM valo_privacy_erasure_objects
        WHERE case_id=${id}::uuid AND status<>'deleted'`);
      if(count.rows[0]?.remaining===0){next=phases[0];detail="All captured private-object deletes were acknowledged. Object tombstones are retained for recovery replay.";}
    }else if((phases as readonly string[]).includes(start.phase)){
      // CTID selection stays within this locked transaction and static table
      // allowlist. A crash rolls back the batch; retries never need a cursor.
      const result=await eraseSection(tx,row.workspaceId,start.phase as typeof phases[number]);
      if((result.rowCount??0)<100)next=phases[phases.indexOf(start.phase as typeof phases[number])+1]??"application_erased";
      detail=`Removed ${result.rowCount??0} rows from the current scoped application section. Remaining sections and exclusions are not claimed complete.`;
    }else if(start.phase!=="application_erased")throw new ValoProblem(409,"Unknown erasure phase. Processing is held.");
    const done=next==="application_erased";
    if(done)await tx.update(valoWorkspaces).set({profileRevision:0}).where(eq(valoWorkspaces.id,row.workspaceId));
    row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"erasure_batch_recorded",input.reason,{
      erasurePhase:next,status:done?"partially_fulfilled":"in_progress",
      resultScope:done?"Named application content and captured private objects erased in development. Membership remains revoked. Financial, support/privacy, audit, managed identity, backups and external-provider outcomes remain held; this is not complete account deletion.":row.resultScope,
      steps:row.steps.map(s=>s.system==="application"?{...s,status:done?"confirmed":"running",detail}:
        s.system==="private_files"?{...s,status:next!=="objects"&&next!=="quarantined"?"confirmed":"running",detail:next!=="objects"&&next!=="quarantined"?
          "Captured object deletions acknowledged; durable keys retained for restore/late-write replay.":detail}:
        s.system==="identity_verification"?s:{...s,status:"held",detail:"Retained or external scope has not been fulfilled. No legal-retention duration or external deletion is asserted."})});
    return privacyDetail(tx,row);
  });
}

/** Run against the restored environment using the retained post-cutoff journal.
 * Importing that journal is a recovery-owner operation; this does not pretend
 * a tombstone absent from an old backup can reappear without it. */
export async function replayErasureObjects(caseId:string,remove:DeleteObject=deletePrivateFile){
  assertDevelopmentRuntime();
  const[tombstone]=await db.select().from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.caseId,caseId));
  if(!tombstone)throw new ValoProblem(404,"A retained deletion tombstone is required.");
  const[workspace]=await db.select().from(valoWorkspaces).where(eq(valoWorkspaces.id,tombstone.workspaceId));
  const historicalKey=await db.transaction(tx=>privacyKey(tx,tombstone.keyVersion));
  if(!workspace||!/^(synthetic-|privacy-fixture-)/.test(workspace.ownerIdentityId)||
    quotaSubjectHash(historicalKey,"user",workspace.ownerIdentityId)!==tombstone.identityHash)
    throw new ValoProblem(409,"Recovery workspace does not match the retained synthetic deletion journal.");
  await db.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.workspaceId,tombstone.workspaceId));
  const rows=await db.execute<{workspace_id:string;object_key:string}>(sql`SELECT workspace_id,object_key
    FROM valo_privacy_erasure_objects WHERE case_id=${caseId}::uuid AND workspace_id=${tombstone.workspaceId}::uuid ORDER BY object_key`);
  let deleted=0,failed=0;
  for(const row of rows.rows){
    await db.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.workspaceId,row.workspace_id));
    try{assertObjectScope(tombstone.workspaceId,row.object_key);await remove(row.object_key);deleted++;}catch{failed++;}
  }
  return {deleted,failed,externalSystemsFulfilled:false};
}

/** Bounded physical re-erasure after importing the authenticated post-cutoff
 * deletion journal. Repeat until remaining=false. No email/refund/charge path. */
export async function replayErasedApplication(caseId:string,remove:DeleteObject=deletePrivateFile){
  const objects=await replayErasureObjects(caseId,remove);
  if(objects.failed)return {...objects,remaining:true,applicationRowsRemoved:0};
  return db.transaction(async tx=>{
    const[tombstone]=await tx.select().from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.caseId,caseId)).for("update");
    if(!tombstone)throw new ValoProblem(404,"Deletion journal is unavailable.");
    const row=await readPrivacyCase(tx,caseId);
    if(row.workspaceId!==tombstone.workspaceId||row.erasurePhase!=="application_erased")
      throw new ValoProblem(409,"Only a completed scoped application erasure can be physically replayed. Resume unfinished requests through privacy operations.");
    let applicationRowsRemoved=0,remaining=false;
    for(const section of phases){
      const result=await eraseSection(tx,tombstone.workspaceId,section);
      applicationRowsRemoved+=result.rowCount??0;
      if((result.rowCount??0)>=100){remaining=true;break;}
    }
    if(!remaining)await tx.update(valoWorkspaces).set({profileRevision:0}).where(eq(valoWorkspaces.id,tombstone.workspaceId));
    return {...objects,remaining,applicationRowsRemoved};
  });
}
