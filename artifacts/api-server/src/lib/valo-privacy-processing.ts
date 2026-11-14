import {and,eq} from "drizzle-orm";
import {db,valoProfileVersions,valoWorkspaces} from "@workspace/db";
import {ActOnStaffPrivacyCaseBody} from "@workspace/api-zod";
import {authorizeWorkspaceWrite} from "./valo-store";
import {workspaceDataExport} from "./valo-customer-access";
import {ValoProblem} from "./valo-problem";
import {assertPrivacyVersion} from "./valo-privacy-state";
import {requirePrivacyStaff,readPrivacyCase,privacyChange,privacyDetail,simpleStaffPrivacyAction,type PrivacyStaffActor} from "./valo-privacy";
export async function processPrivacyAction(actor:PrivacyStaffActor,id:string,raw:unknown){
  const input=ActOnStaffPrivacyCaseBody.strict().parse(raw);
  if(input.action==="prepare_export")return preparePrivacyExport(actor,id,input);
  if(input.action==="record_correction")return recordPrivacyCorrection(actor,id,input);
  if(input.action==="start_erasure"||input.action==="resume_erasure")
    throw new ValoProblem(503,"The erasure processor is not enabled. No deletion was performed; retention approval and the resumable processor must be ready first.");
  return simpleStaffPrivacyAction(actor,id,input);
}
async function preparePrivacyExport(actor:PrivacyStaffActor,id:string,input:ReturnType<typeof ActOnStaffPrivacyCaseBody.parse>){
  const start=await db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);let row=await readPrivacyCase(tx,id);
    assertPrivacyVersion(row.version,input.expectedVersion);
    if(row.kind!=="export")throw new ValoProblem(422,"Only an export request can prepare this result.");
    if(!row.verifiedAt||row.assignedIdentityId!==actor.identityId)throw new ValoProblem(403,"Verify the owner and claim this case before preparing its result.");
    if(row.resultJson)return {row,alreadyPrepared:true};
    row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"application_export_started",input.reason,
      {status:"in_progress",steps:row.steps.map(s=>s.system==="application"?{...s,status:"running",detail:"Preparing the application JSON sections; no provider export is implied."}:s)});
    return {row,alreadyPrepared:false};
  });
  if(start.alreadyPrepared)return db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);return privacyDetail(tx,await readPrivacyCase(tx,id));
  });
  try{
    const result=await workspaceDataExport({identityId:start.row.requesterIdentityId,workspaceId:start.row.workspaceId});
    return await db.transaction(async tx=>{
      await requirePrivacyStaff(tx,actor);let row=await readPrivacyCase(tx,id);
      assertPrivacyVersion(row.version,start.row.version);
      if(row.assignedIdentityId!==actor.identityId)throw new ValoProblem(403,"The case assignment changed. No result was released.");
      await authorizeWorkspaceWrite(tx,{identityId:row.requesterIdentityId,workspaceId:row.workspaceId});
      row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"application_export_prepared",input.reason,{
        status:"partially_fulfilled",resultJson:result,resultScope:result.scope,
        steps:row.steps.map(s=>s.system==="application"?{...s,status:"confirmed",detail:"The named application JSON sections were read under current workspace authorization and saved as this immutable prepared result."}:
          s.system==="identity_verification"?s:{...s,status:"held",detail:s.system==="private_files"?
            "Export/file metadata is included; rendered private file bytes are not included in this result.":s.system==="managed_identity"?
              "Managed sign-in-provider data has not been prepared in this result.":s.system==="external_processors"?
                "External processor access has not been fulfilled or represented as complete.":
                "Retention exceptions and recovery handling have not been confirmed. No complete privacy-fulfilment claim is made."})});
      return privacyDetail(tx,row);
    });
  }catch(error){
    await db.transaction(async tx=>{
      await requirePrivacyStaff(tx,actor);const row=await readPrivacyCase(tx,id);
      if(row.version===start.row.version)await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"application_export_failed",
        "Application preparation failed; no result was released. Retry requires current authorization.",{status:"failed",
          steps:row.steps.map(s=>s.system==="application"?{...s,status:"failed",detail:"No prepared result was released. Existing customer data was not changed."}:s)});
    }).catch(()=>{/* Original failure is preserved; a revoked actor cannot write a failure transition. */});
    throw error;
  }
}
async function recordPrivacyCorrection(actor:PrivacyStaffActor,id:string,input:ReturnType<typeof ActOnStaffPrivacyCaseBody.parse>){
  if(!input.profileVersionId||input.acknowledgement!==true)
    throw new ValoProblem(422,"Provide the actual corrected profile revision and explicitly confirm its checked scope.");
  const profileVersionId=input.profileVersionId;
  return db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);let row=await readPrivacyCase(tx,id);
    assertPrivacyVersion(row.version,input.expectedVersion);
    if(row.kind!=="correction")throw new ValoProblem(422,"Only a correction request can record this outcome.");
    if(!row.verifiedAt||row.assignedIdentityId!==actor.identityId)throw new ValoProblem(403,"Verify and claim this case before recording a correction.");
    await authorizeWorkspaceWrite(tx,{identityId:row.requesterIdentityId,workspaceId:row.workspaceId});
    const[profile]=await tx.select().from(valoProfileVersions).where(and(eq(valoProfileVersions.id,profileVersionId),
      eq(valoProfileVersions.workspaceId,row.workspaceId)));
    const[workspace]=await tx.select({revision:valoWorkspaces.profileRevision}).from(valoWorkspaces).where(eq(valoWorkspaces.id,row.workspaceId)).for("share");
    const baseline=row.steps.find(s=>s.system==="application");
    if(baseline?.profileRevisionAtRequest===undefined||
      (baseline.profileRevisionAtRequest>0&&!baseline.profileHashAtRequest))
      throw new ValoProblem(409,"This older request has no verified profile baseline. Record a newly verified request rather than inventing its history.");
    if(!profile||!workspace||profile.revision!==workspace.revision||profile.revision<=baseline.profileRevisionAtRequest||
      profile.profileHash===baseline.profileHashAtRequest)
      throw new ValoProblem(409,"The correction must reference a real current profile revision saved for this workspace after the request. No historic profile was overwritten.");
    row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"correction_processing_started",input.reason,{status:"in_progress"});
    row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},"profile_correction_recorded",input.reason,{
      status:"partially_fulfilled",resultJson:{kind:"business_profile_correction",profileVersionId:profile.id,revision:profile.revision,
        profileHash:profile.profileHash,profile:profile.profile,correctedAt:profile.createdAt.toISOString(),
        scope:"This confirms the referenced current business-profile revision only. Prior immutable assessments and source snapshots were preserved; other account/provider corrections are not confirmed."},
      resultScope:"The current business-profile correction has a real revision and result. Other requested records and provider systems remain unconfirmed.",
      steps:row.steps.map(s=>s.system==="application"?{...s,status:"confirmed",detail:`Current business profile revision ${profile.revision} was checked against this workspace. Earlier versions remain traceable.`}:
        s.system==="identity_verification"?s:{...s,status:"held",detail:"This profile result does not confirm correction or fulfilment across this system."})});
    return privacyDetail(tx,row);
  });
}
export async function privacyPreparedResult(actor:{identityId:string;workspaceId:string},id:string){
  return db.transaction(async tx=>{
    await authorizeWorkspaceWrite(tx,actor);const row=await readPrivacyCase(tx,id,actor);
    if(!row.resultJson)throw new ValoProblem(404,"No result is available. A received or verified request is not a prepared export.");
    return row.resultJson;
  });
}
