import { randomUUID,createHash } from "node:crypto";
import {createPrivacyCase} from "./valo-privacy";
import { and,eq,desc,like } from "drizzle-orm";
import { db,valoAccessSupport,valoStaffAssignments,valoSupportTickets,valoProfileVersions,
  valoDocuments,valoDocumentRevisions,valoAssessments,valoTasks,valoReminderPreferences,
  valoReminderOutbox,valoAIDrafts,valoContentVersions,valoSafetySwitches,valoStaffAccessAudit } from "@workspace/db";
import { RequestAccessSupportBody,RequestCustomerPrivacyBody } from "@workspace/api-zod";
import { consumeQuota,quotaSubjectHash } from "./valo-quota";
import { authorizeWorkspaceWrite,createTicket,ValoProblem,type WorkspaceActor } from "./valo-store";
import { valoOrders,valoEntitlements,valoPurchaseOutbox,valoRefundRequests,valoPaymentReconciliations } from "@workspace/db";
export const accessMessage="Request received and saved. No account details have been confirmed. Replies are not yet dispatched from this development build.";
const ack=(id:string)=>({reference:`VALO-ACCESS-${id}`,message:accessMessage,delivery:"not_dispatched" as const});
export async function saveAccessSupport(raw:unknown,remoteAddress:string){
  const input=RequestAccessSupportBody.strict().parse(raw);
  const data={email:input.email.trim().toLowerCase(),topic:input.topic,message:input.message.trim()};
  if(data.message.length<20)throw new ValoProblem(422,"Please include at least20 characters describing the problem.");
  const payloadHash=createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return db.transaction(async tx=>{
    const id=randomUUID();
    const inserted=await tx.insert(valoAccessSupport).values({id,idempotencyKey:input.idempotencyKey,
      payloadHash,contactEmail:data.email,topic:data.topic,message:data.message,noticeVersion:"development-access-support-1"})
      .onConflictDoNothing({target:valoAccessSupport.idempotencyKey}).returning();
    if(!inserted.length){
      const[old]=await tx.select().from(valoAccessSupport).where(eq(valoAccessSupport.idempotencyKey,input.idempotencyKey));
      if(!old||old.payloadHash!==payloadHash)throw new ValoProblem(409,"This request key was already used. Start a new request.");
      return ack(old.id);
    }
    // Socket address only: hostile Forwarded/X-Forwarded-For cannot choose a quota identity.
    for(const [kind,value,minute,day] of[
      ["user",`access-contact:${data.email}`,3,20],["ip",`access-socket:${remoteAddress}`,20,100],
      ["user","access-intake-global",100,1000]] as const){
      const hash=quotaSubjectHash(process.env.SESSION_SECRET,kind,value);
      for(const [bucket,limit,window] of[["public-support",minute,"minute"],["public-support-day",day,"day"]] as const){
        const q=await consumeQuota(bucket,hash,limit,window,tx);
        if(!q.allowed)throw new ValoProblem(429,`Please retry in ${q.retryAfter} seconds. No new request was saved.`,undefined,q.retryAfter);
      }
    }
    return ack(id);
  });
}
export async function customerAccount(actor:WorkspaceActor){
  return db.transaction(async tx=>{
    await authorizeWorkspaceWrite(tx,actor);
    const rows=await tx.select().from(valoSupportTickets).where(and(eq(valoSupportTickets.workspaceId,actor.workspaceId),
      like(valoSupportTickets.scope,"Privacy request (%"))).orderBy(desc(valoSupportTickets.createdAt)).limit(100);
    return{workspaceId:actor.workspaceId,privacyRequests:rows.map(r=>({reference:`VALO-${r.id}`,request:r.scope,
      status:r.dispatchStatus,createdAt:r.createdAt.toISOString()}))};
  });
}
export async function requestPrivacy(actor:WorkspaceActor,email:string,raw:unknown){
  return createPrivacyCase(actor,email,raw);
}
export async function workspaceDataExport(actor:WorkspaceActor){
  return db.transaction(async tx=>{
    await authorizeWorkspaceWrite(tx,actor);
    const tables={profileVersions:valoProfileVersions,documents:valoDocuments,documentRevisions:valoDocumentRevisions,
      assessments:valoAssessments,tasks:valoTasks,reminderPreferences:valoReminderPreferences,
      reminderDeliveries:valoReminderOutbox,supportRequests:valoSupportTickets,aiDrafts:valoAIDrafts,
      orders:valoOrders,entitlements:valoEntitlements,purchaseMessages:valoPurchaseOutbox,
      refundRequests:valoRefundRequests,paymentReconciliations:valoPaymentReconciliations};
    const data:Record<string,unknown>={};
    let bytes=0;
    for(const [name,table] of Object.entries(tables)){
      const rows=await tx.select().from(table).where(eq(table.workspaceId,actor.workspaceId)).limit(5001);
      if(rows.length>5000)throw new ValoProblem(409,"This workspace needs an assisted full export. Submit a privacy export request; no partial file was returned.");
      bytes+=Buffer.byteLength(JSON.stringify(rows));
      if(bytes>8_000_000)throw new ValoProblem(409,"This workspace needs an assisted full export. Submit a privacy export request; no partial file was returned.");
      data[name]=rows;
    }
    return{schemaVersion:1,exportedAt:new Date().toISOString(),workspaceId:actor.workspaceId,
      scope:"Only the named sections under data are included; this is not complete privacy fulfilment. Does not include private file bytes, file/job metadata, membership/audit records, managed identity records, external provider data or unlinked public contact requests. Request coordinated access for those systems.",
      data};
  });
}
export type StaffArea="content"|"support"|"finance"|"system";
export async function staffOperations(identityId:string,recentMfa:boolean,area:StaffArea){
  return db.transaction(async tx=>{
    const[assignment]=await tx.select().from(valoStaffAssignments).where(and(eq(valoStaffAssignments.identityId,identityId),
      eq(valoStaffAssignments.role,area),eq(valoStaffAssignments.active,true))).for("share");
    if(!assignment)throw new ValoProblem(403,"This account has no active permission for this staff area. Customer sign-in does not grant staff access.");
    if(!recentMfa)throw new ValoProblem(403,"Recent multi-factor verification is required for staff access.");
    await tx.insert(valoStaffAccessAudit).values({id:randomUUID(),assignmentId:assignment.id,actorId:identityId,area,
      reason:"Read-only operational access after active role and recent MFA checks"});
    let records:Record<string,unknown>[]=[];
    let notice="Read-only operational records. No publish, payment, role or customer-document mutation is available here.";
    if(area==="content")records=await tx.select({id:valoContentVersions.id,templateId:valoContentVersions.templateId,
      slug:valoContentVersions.slug,version:valoContentVersions.version,status:valoContentVersions.status,
      reviewBy:valoContentVersions.reviewBy}).from(valoContentVersions).limit(200);
    if(area==="support"){
      const intake=await tx.select().from(valoAccessSupport).orderBy(desc(valoAccessSupport.createdAt)).limit(100);
      const privateTickets=await tx.select().from(valoSupportTickets).orderBy(desc(valoSupportTickets.createdAt)).limit(100);
      records=[...intake.map(r=>({...r,kind:"public_access_request"})),...privateTickets.map(r=>({...r,kind:"workspace_request"}))];
      // Intake idempotency and payload hashes are not needed by staff.
      records=records.map(({payloadHash,idempotencyKey,...r})=>r);
    }
    if(area==="finance"){
      const orders=await tx.select({id:valoOrders.id,reference:valoOrders.reference,amountKobo:valoOrders.amountKobo,
        currency:valoOrders.currency,status:valoOrders.status,lastCheckedAt:valoOrders.lastCheckedAt}).from(valoOrders).orderBy(desc(valoOrders.createdAt)).limit(100);
      const refunds=await tx.select({id:valoRefundRequests.id,orderId:valoRefundRequests.orderId,status:valoRefundRequests.status,
        createdAt:valoRefundRequests.createdAt}).from(valoRefundRequests).orderBy(desc(valoRefundRequests.createdAt)).limit(100);
      const reconciliation=await tx.select().from(valoPaymentReconciliations).orderBy(desc(valoPaymentReconciliations.createdAt)).limit(100);
      records=[...orders.map(r=>({...r,kind:"test_order"})),...refunds.map(r=>({...r,kind:"refund_request"})),
        ...reconciliation.map(r=>({...r,kind:"daily_reconciliation"}))];
      notice="Test-mode financial records only. Refund requests are not completed refunds. This role cannot read document bodies, edit financial history or grant entitlement directly. Provider execution remains dependent on test-merchant setup.";
    }
    if(area==="system")records=await tx.select().from(valoSafetySwitches).limit(100);
    return{area,notice,records};
  });
}
