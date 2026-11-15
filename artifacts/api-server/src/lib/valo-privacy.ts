import {randomUUID,createHash} from "node:crypto";
import {and,eq,desc,asc,sql} from "drizzle-orm";
import {db,valoPrivacyCases,valoPrivacyEvents,valoPrivacyMessages,valoStaffAssignments,valoStaffAccessAudit,valoWorkspaces,valoProfileVersions,type PrivacyStep} from "@workspace/db";
import {RequestCustomerPrivacyBody,VerifyPrivacyCaseBody,ActOnStaffPrivacyCaseBody,RespondPrivacyCaseBody} from "@workspace/api-zod";
import {authorizeWorkspaceWrite,createTicketInTransaction,limitWorkspaceWrite,type WorkspaceActor} from "./valo-store";
import {quotaSubjectHash} from "./valo-quota";
import {ValoProblem} from "./valo-problem";
import {privacyKey,privacySigner} from "./valo-privacy-keys";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
import {removedPrivateText,verifiedPrivacyRedaction} from "./valo-privacy-redactions";
import {assertPrivacyVersion,assertPrivacyTransition,assertPrivacyCompletion,privacyInitialSteps,privacyAuditHash,privacyAuditEqual,privacySnapshotHash,
  type PrivacyAuditInput,type PrivacyStatus} from "./valo-privacy-state";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PrivacyRow=typeof valoPrivacyCases.$inferSelect;
export type PrivacyStaffActor={identityId:string;recentMfa:boolean;verifiedAt:number};
const GENESIS="0".repeat(64);
function stateHash(row:Partial<PrivacyRow>){
  return privacySnapshotHash([row.id,row.workspaceId,row.requesterIdentityId,row.kind,row.idempotencyKey,row.payloadHash,row.message,
    row.status??"awaiting_verification",row.version??1,row.assignedIdentityId??null,row.verifiedAt??null,row.resultJson??null,
    row.resultScope??"No result has been prepared or provider action confirmed.",row.steps,row.erasurePhase??"not_started",
    row.createdAt,row.updatedAt]);
}
export async function requirePrivacyStaff(tx:Tx,actor:PrivacyStaffActor){
  if(!actor.recentMfa||!Number.isFinite(actor.verifiedAt)||actor.verifiedAt>Date.now()+1000||Date.now()-actor.verifiedAt>30_000)
    throw new ValoProblem(403,"A recently server-verified staff session with fresh MFA is required.");
  const[role]=await tx.select().from(valoStaffAssignments).where(and(eq(valoStaffAssignments.identityId,actor.identityId),
    eq(valoStaffAssignments.role,"privacy"),eq(valoStaffAssignments.active,true))).for("share");
  if(!role)throw new ValoProblem(403,"An active privacy-operations assignment is required. Other staff roles cannot access this queue.");
  return role;
}
export async function readPrivacyCase(tx:Tx,id:string,actor?:WorkspaceActor){
  const[row]=await tx.select().from(valoPrivacyCases).where(actor?
    and(eq(valoPrivacyCases.id,id),eq(valoPrivacyCases.workspaceId,actor.workspaceId),
      eq(valoPrivacyCases.requesterIdentityId,actor.identityId)):eq(valoPrivacyCases.id,id)).for("update");
  if(!row)throw new ValoProblem(404,"Privacy request not found.");
  await checkPrivacyAudit(tx,row);
  return row;
}
export async function checkPrivacyAudit(tx:Tx,row:PrivacyRow){
  const events=await tx.select().from(valoPrivacyEvents).where(and(eq(valoPrivacyEvents.caseId,row.id),
    eq(valoPrivacyEvents.workspaceId,row.workspaceId))).orderBy(asc(valoPrivacyEvents.sequence));
  let previous=GENESIS;
  for(let n=0;n<events.length;n++){
    const e=events[n]!;
    const redacted=e.reason===removedPrivateText&&await verifiedPrivacyRedaction(tx,e.id,e.workspaceId,e.eventHash);
    if(e.sequence!==n+1||e.previousHash!==previous||
      !redacted&&!privacyAuditEqual(e.eventHash,privacyAuditHash(e,await privacyKey(tx,e.keyVersion))))
      throw new ValoProblem(409,"Privacy audit integrity could not be verified. Processing is held for investigation.");
    previous=e.eventHash;
  }
  if(events.length!==row.version||!privacyAuditEqual(row.lastEventHash,previous)||
    !privacyAuditEqual(events.at(-1)?.stateHash??"",stateHash(row)))
    throw new ValoProblem(409,"Privacy request history is incomplete or altered. Processing is held for investigation.");
  return events;
}
export function privacyCaseRecord(row:PrivacyRow){
  return {id:row.id,workspaceId:row.workspaceId,reference:`VALO-${row.id}`,kind:row.kind,message:row.message,
    status:row.status,version:row.version,assigned:!!row.assignedIdentityId,verifiedAt:row.verifiedAt?.toISOString()??null,
    resultAvailable:!!row.resultJson,resultScope:row.resultScope,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
export async function privacyDetail(tx:Tx,row:PrivacyRow){
  const events=await checkPrivacyAudit(tx,row);
  const messages=await tx.select().from(valoPrivacyMessages).where(and(eq(valoPrivacyMessages.caseId,row.id),
    eq(valoPrivacyMessages.workspaceId,row.workspaceId))).orderBy(asc(valoPrivacyMessages.createdAt),asc(valoPrivacyMessages.id));
  return {request:privacyCaseRecord(row),events:events.map(e=>({sequence:e.sequence,action:e.action,actorType:e.actorType,
    reason:e.reason,createdAt:e.createdAt.toISOString()})),steps:row.steps,
    messages:messages.map(m=>({id:m.id,body:m.body,createdAt:m.createdAt.toISOString()})),
    mayRespond:row.status==="needs_information"&&(row.erasurePhase==="not_started"||!!row.verifiedAt)};
}
export async function privacyChange(tx:Tx,row:PrivacyRow,actor:{identityId:string;type:PrivacyAuditInput["actorType"]},
  action:string,reason:string,patch:Partial<Pick<PrivacyRow,"message"|"status"|"assignedIdentityId"|"verifiedAt"|"resultJson"|"resultScope"|"steps"|"erasurePhase">>){
  if(patch.status&&patch.status!==row.status)assertPrivacyTransition(row.status,patch.status);
  if(patch.status==="fulfilled")assertPrivacyCompletion(patch.steps??row.steps);
  const at=new Date(),version=row.version+1;
  const signer=await privacySigner(tx);
  const event:PrivacyAuditInput={workspaceId:row.workspaceId,caseId:row.id,sequence:version,actorType:actor.type,
    actorHash:quotaSubjectHash(signer.key,"user",actor.identityId),action,reason,createdAt:at,previousHash:row.lastEventHash,
    stateHash:stateHash({...row,...patch,version,updatedAt:at}),keyVersion:signer.version};
  const eventHash=privacyAuditHash(event,signer.key);
  await tx.insert(valoPrivacyEvents).values({id:randomUUID(),...event,eventHash});
  const[next]=await tx.update(valoPrivacyCases).set({...patch,version,lastEventHash:eventHash,updatedAt:at})
    .where(and(eq(valoPrivacyCases.id,row.id),eq(valoPrivacyCases.workspaceId,row.workspaceId),eq(valoPrivacyCases.version,row.version))).returning();
  if(!next)throw new ValoProblem(409,"Privacy request changed. No transition was committed.");
  return next;
}
export async function createPrivacyCase(actor:WorkspaceActor,email:string,raw:unknown){
  const input=RequestCustomerPrivacyBody.strict().parse(raw),idempotencyKey=input.idempotencyKey??randomUUID();
  const message=input.message.trim();
  if(message.length<10)throw new ValoProblem(422,"Describe the request in at least 10 non-blank characters.");
  const payloadHash=createHash("sha256").update(JSON.stringify([actor.identityId,input.kind,message])).digest("hex");
  return db.transaction(async tx=>{
    await authorizeWorkspaceWrite(tx,actor);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId+":"+idempotencyKey},0))`);
    const[old]=await tx.select().from(valoPrivacyCases).where(and(eq(valoPrivacyCases.workspaceId,actor.workspaceId),
      eq(valoPrivacyCases.idempotencyKey,idempotencyKey))).for("update");
    if(old){
      if(old.payloadHash!==payloadHash)throw new ValoProblem(409,"This request key belongs to different input. Start a new request.");
      await checkPrivacyAudit(tx,old);
      return {reference:`VALO-${old.id}`,message:"Your existing privacy request remains saved. Check its current processing state.",delivery:"not_dispatched" as const};
    }
    const[workspace]=await tx.select({revision:valoWorkspaces.profileRevision}).from(valoWorkspaces)
      .where(eq(valoWorkspaces.id,actor.workspaceId)).for("share");
    if(!workspace)throw new ValoProblem(404,"Workspace not found.");
    const[baseline]=await tx.select({hash:valoProfileVersions.profileHash}).from(valoProfileVersions)
      .where(and(eq(valoProfileVersions.workspaceId,actor.workspaceId),eq(valoProfileVersions.revision,workspace.revision)));
    const ticket=await createTicketInTransaction(tx,actor,{category:"support",scope:`Privacy request (${input.kind}): ${message}`,
      contactEmail:email,sharingConsent:false});
    const id=ticket.reference.slice(5),at=new Date();
    const initial={id,workspaceId:actor.workspaceId,requesterIdentityId:actor.identityId,kind:input.kind,idempotencyKey,
      payloadHash,message,steps:privacyInitialSteps(input.kind).map(s=>s.system==="application"?
        {...s,profileRevisionAtRequest:workspace.revision,...(baseline?{profileHashAtRequest:baseline.hash}:{})}:s),createdAt:at,updatedAt:at};
    const signer=await privacySigner(tx);
    const event:PrivacyAuditInput={workspaceId:actor.workspaceId,caseId:id,sequence:1,actorType:"customer",
      actorHash:quotaSubjectHash(signer.key,"user",actor.identityId),action:"request_received",reason:"The owner submitted a request; verification and processing are not yet complete.",
      createdAt:at,previousHash:GENESIS,stateHash:stateHash(initial),keyVersion:signer.version};
    const eventHash=privacyAuditHash(event,signer.key);
    await tx.insert(valoPrivacyCases).values({...initial,lastEventHash:eventHash});
    await tx.insert(valoPrivacyEvents).values({id:randomUUID(),...event,eventHash});
    return {reference:ticket.reference,message:"Privacy request saved. Verify it in request processing; no export, correction, deletion or provider action has been completed.",
      delivery:"not_dispatched" as const};
  });
}
export async function listPrivacyCases(actor:WorkspaceActor){
  return db.transaction(async tx=>{
    await authorizeWorkspaceWrite(tx,actor);
    const rows=await tx.select().from(valoPrivacyCases).where(and(eq(valoPrivacyCases.workspaceId,actor.workspaceId),
      eq(valoPrivacyCases.requesterIdentityId,actor.identityId))).orderBy(desc(valoPrivacyCases.createdAt)).limit(10001);
    if(rows.length>10000)throw new ValoProblem(409,"This history requires assisted retrieval; no truncated history has been returned.");
    return rows.map(privacyCaseRecord);
  });
}
export async function customerPrivacyDetail(actor:WorkspaceActor,id:string){
  return db.transaction(async tx=>{await authorizeWorkspaceWrite(tx,actor);return privacyDetail(tx,await readPrivacyCase(tx,id,actor));});
}
export async function confirmPrivacyCase(actor:WorkspaceActor,id:string,raw:unknown,cancel=false){
  const input=VerifyPrivacyCaseBody.strict().parse(raw);
  return db.transaction(async tx=>{
    await authorizeWorkspaceWrite(tx,actor);
    let row=await readPrivacyCase(tx,id,actor);assertPrivacyVersion(row.version,input.expectedVersion);
    if(cancel&&row.erasurePhase!=="not_started")throw new ValoProblem(409,"Erasure has begun; cancellation cannot promise to recover already erased data. Contact privacy operations.");
    const steps:PrivacyStep[]=row.steps.map(s=>s.system==="identity_verification"&&!cancel?
      {...s,status:"confirmed",detail:"The active managed verified-email owner identity matched this request and explicitly confirmed it."}:s);
    row=await privacyChange(tx,row,{identityId:actor.identityId,type:"customer"},cancel?"request_cancelled":"identity_verified",
      cancel?"The owner cancelled before destructive processing. Previously completed processing is not reversed.":
        "The active managed owner session and current workspace membership were checked. No provider fulfilment is implied.",
      {status:cancel?"cancelled":row.status==="needs_information"?"needs_information":"verified",...(!cancel?{verifiedAt:new Date(),steps}:{})});
    return privacyDetail(tx,row);
  });
}
export async function listStaffPrivacyCases(actor:PrivacyStaffActor,page:number){
  if(!Number.isSafeInteger(page)||page<1)throw new ValoProblem(422,"Choose a valid page.");
  return db.transaction(async tx=>{
    const role=await requirePrivacyStaff(tx,actor),pageSize=20;
    const[total]=await tx.select({count:sql<number>`count(*)::integer`}).from(valoPrivacyCases);
    const rows=await tx.select().from(valoPrivacyCases).orderBy(desc(valoPrivacyCases.createdAt),desc(valoPrivacyCases.id))
      .limit(pageSize).offset((page-1)*pageSize);
    await tx.insert(valoStaffAccessAudit).values({id:randomUUID(),assignmentId:role.id,actorId:actor.identityId,area:"privacy",
      reason:"Viewed the privacy request queue; no customer document body was returned."});
    return {items:rows.map(privacyCaseRecord),page,total:total?.count??0,pageSize};
  });
}
export async function respondPrivacyCase(actor:WorkspaceActor,id:string,raw:unknown){
  const input=RespondPrivacyCaseBody.strict().parse(raw);
  if(input.message.trim().length<10)throw new ValoProblem(422,"Provide at least ten non-padding characters of additional information.");
  return db.transaction(async tx=>{
    let row=await readPrivacyCase(tx,id,actor);
    // A quarantined requester retains case-only rights, never workspace rights.
    // The HTTP entry verifies the live identity; the signed case binds that
    // identity and workspace. Ordinary pre-erasure writes still need membership.
    if(row.erasurePhase==="not_started")await authorizeWorkspaceWrite(tx,actor);
    else if(!row.verifiedAt)throw new ValoProblem(403,"A verified requester is required.");
    const[existing]=await tx.select().from(valoPrivacyMessages).where(and(eq(valoPrivacyMessages.caseId,id),
      eq(valoPrivacyMessages.replyToVersion,input.expectedVersion)));
    if(existing&&existing.body===input.message.trim())return privacyDetail(tx,row);
    assertPrivacyVersion(row.version,input.expectedVersion);
    if(row.status!=="needs_information")
      throw new ValoProblem(409,"This case is not waiting for additional information. No reply was saved.");
    await limitWorkspaceWrite(tx,actor,"support");
    await tx.insert(valoPrivacyMessages).values({id:randomUUID(),workspaceId:actor.workspaceId,caseId:id,
      replyToVersion:input.expectedVersion,body:input.message.trim()});
    row=await privacyChange(tx,row,{identityId:actor.identityId,type:"customer"},"information_received",
      "The customer supplied additional information. This did not verify identity or fulfil the request.",{
        // Information returns to the assigned operator; it does not itself
        // resume destruction or imply any fulfilment.
        status:row.verifiedAt?row.assignedIdentityId?"assigned":"verified":"awaiting_verification",
      });
    return privacyDetail(tx,row);
  });
}
export function availablePrivacyActions(row:PrivacyRow,identityId:string){
  const actions:("claim"|"request_information"|"hold"|"release_hold"|"reject"|"prepare_export"|"record_correction"|"start_erasure"|"resume_erasure")[]=[];
  if(row.assignedIdentityId&&row.assignedIdentityId!==identityId)return actions;
  const can=(next:PrivacyStatus)=>{try{assertPrivacyTransition(row.status,next);return true;}catch{return false;}};
  if(can("held"))actions.push("hold");
  if(row.erasurePhase!=="not_started"){
    if(row.status==="held")actions.push("release_hold");
    else if(can("needs_information"))actions.push("request_information");
    if(["assigned","in_progress","failed","partially_fulfilled"].includes(row.status))actions.push("resume_erasure");
    return actions;
  }
  if(can("needs_information"))actions.push("request_information");
  if(can("rejected"))actions.push("reject");
  if(row.verifiedAt&&!row.assignedIdentityId&&can("assigned"))actions.push("claim");
  if(row.status==="held")actions.push("release_hold");
  if(row.status==="assigned"&&row.verifiedAt&&row.assignedIdentityId===identityId){
    if(row.kind==="export")actions.push("prepare_export");
    if(row.kind==="correction")actions.push("record_correction");
    try{assertDevelopmentRuntime();if(row.kind==="deletion"&&/^(synthetic-|privacy-fixture-)/.test(row.requesterIdentityId))actions.push("start_erasure");}catch{/* Development erasure is not an available production operation. */}
  }
  return actions;
}
export async function staffPrivacyDetail(actor:PrivacyStaffActor,id:string){
  return db.transaction(async tx=>{
    const role=await requirePrivacyStaff(tx,actor),row=await readPrivacyCase(tx,id);
    await tx.insert(valoStaffAccessAudit).values({id:randomUUID(),assignmentId:role.id,actorId:actor.identityId,area:"privacy",
      reason:"Read privacy case history, processing scope and information messages without changing case state."});
    return{...await privacyDetail(tx,row),availableActions:availablePrivacyActions(row,actor.identityId)};
  });
}
export async function simpleStaffPrivacyAction(actor:PrivacyStaffActor,id:string,raw:unknown){
  const input=ActOnStaffPrivacyCaseBody.strict().parse(raw);
  return db.transaction(async tx=>{
    await requirePrivacyStaff(tx,actor);let row=await readPrivacyCase(tx,id);
    assertPrivacyVersion(row.version,input.expectedVersion);
    const status={claim:"assigned",request_information:"needs_information",hold:"held",
      release_hold:row.erasurePhase!=="not_started"?(row.erasurePhase==="application_erased"?"partially_fulfilled":"in_progress"):
        !row.verifiedAt?"awaiting_verification":row.assignedIdentityId?"assigned":"verified",
      reject:"rejected"}[input.action as "claim"];
    if(!status)throw new ValoProblem(422,"This operation must use its dedicated processing service.");
    if(input.action==="claim"&&!row.verifiedAt)throw new ValoProblem(409,"The owner must verify the request before it can be assigned.");
    if(row.status==="held"&&input.action!=="release_hold")
      throw new ValoProblem(409,"Release the recorded hold explicitly before another case action. Claim cannot bypass a hold.");
    if(input.action==="release_hold"&&row.status!=="held")throw new ValoProblem(409,"Only a held request can release its hold.");
    if(row.assignedIdentityId&&row.assignedIdentityId!==actor.identityId)throw new ValoProblem(403,"This case is assigned to another privacy operator.");
    if(row.erasurePhase!=="not_started"&&input.action==="reject")
      throw new ValoProblem(409,"Started erasure cannot be rejected or reset as if nothing happened. Resume its recorded steps.");
    row=await privacyChange(tx,row,{identityId:actor.identityId,type:"staff"},input.action,input.reason,
      {status:status as PrivacyStatus,...(input.action==="claim"?{assignedIdentityId:actor.identityId}:{})});
    return privacyDetail(tx,row);
  });
}
