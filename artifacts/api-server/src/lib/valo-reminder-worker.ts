import { and,eq,inArray,lte } from "drizzle-orm";
import { db,valoWorkspaces,valoTasks,valoReminderOutbox,valoReminderPreferences } from "@workspace/db";
import { ValoProblem } from "./valo-store";
import { releasedRegistry,workspaceTransaction } from "./valo-assessments";
import { reminderInstant } from "./valo-tasks";

/** Production adapter must provide provider-side idempotency; no adapter is configured yet. */
export type ReminderSender={send(input:{idempotencyKey:string;ownerIdentityId:string;
  title:string;dueDate:string;timezone:"Africa/Lagos"}):Promise<{providerMessageId:string}>};
export async function processReminder(workspaceId:string,id:string,sender:ReminderSender|null=null,now=new Date()){
  const[workspace]=await db.select().from(valoWorkspaces).where(eq(valoWorkspaces.id,workspaceId));
  if(!workspace)throw new ValoProblem(404,"Workspace not found");
  return workspaceTransaction({workspaceId,identityId:workspace.ownerIdentityId},async tx=>{
    const[row]=await tx.select().from(valoReminderOutbox).where(and(eq(valoReminderOutbox.workspaceId,workspaceId),
      eq(valoReminderOutbox.id,id)));
    if(!row)throw new ValoProblem(404,"Reminder not found");
    if(["sent","cancelled"].includes(row.status)||row.scheduledAt>now)return row.status;
    const[prefs]=await tx.select().from(valoReminderPreferences).where(eq(valoReminderPreferences.workspaceId,workspaceId));
    const[task]=await tx.select().from(valoTasks).where(and(eq(valoTasks.workspaceId,workspaceId),eq(valoTasks.id,row.taskId)));
    const offset=Number(row.idempotencyKey.split("/").at(-1));
    let reason:string|null=null;
    if(!prefs?.enabled)reason="REMINDERS_OPTED_OUT";
    else if(!task||task.deletedAt||!task.dueDate||!task.dateConfirmed||task.state==="completed_by_user")
      reason="TASK_NO_LONGER_SCHEDULED";
    else if(!prefs.offsets.includes(offset)||row.idempotencyKey!==`${task.id}/${task.dueDate}/${offset}`||
      reminderInstant(task.dueDate,offset).getTime()!==row.scheduledAt.getTime())reason="SCHEDULE_CHANGED";
    if(reason){await tx.update(valoReminderOutbox).set({status:"cancelled",reason})
      .where(and(eq(valoReminderOutbox.workspaceId,workspaceId),eq(valoReminderOutbox.id,id)));return"cancelled";}
    if(!task?.dueDate)throw new ValoProblem(503,"Reminder task integrity failure");
    if(task.ruleId){
      const registry=await releasedRegistry(tx,now),day=new Date(now.getTime()+3600000).toISOString().slice(0,10);
      if(!registry.rules.some(r=>r.id===task.ruleId&&r.version===task.ruleVersion&&Date.parse(r.reviewBy)>now.getTime()&&
        r.validFrom<=day&&(r.validTo===null||r.validTo>day))){
        await tx.update(valoTasks).set({needsReview:true}).where(and(eq(valoTasks.workspaceId,workspaceId),eq(valoTasks.id,task.id)));
        await tx.update(valoReminderOutbox).set({status:"held",reason:"SOURCE_NO_LONGER_ELIGIBLE"})
          .where(and(eq(valoReminderOutbox.workspaceId,workspaceId),eq(valoReminderOutbox.id,id)));
        return"held";
      }
    }
    if(!sender){
      await tx.update(valoReminderOutbox).set({status:"held",reason:"EMAIL_PROVIDER_NOT_CONFIGURED"})
        .where(and(eq(valoReminderOutbox.workspaceId,workspaceId),eq(valoReminderOutbox.id,id)));return"held";
    }
    const receipt=await sender.send({idempotencyKey:row.idempotencyKey,ownerIdentityId:workspace.ownerIdentityId,
      title:task.title,dueDate:task.dueDate,timezone:"Africa/Lagos"});
    if(!receipt.providerMessageId?.trim())throw new Error("EMAIL_PROVIDER_ACK_MISSING");
    await tx.update(valoReminderOutbox).set({status:"sent",reason:null,providerMessageId:receipt.providerMessageId,
      attempts:row.attempts+1}) // Provider acceptance is not a delivery-confirmation event.
      .where(and(eq(valoReminderOutbox.workspaceId,workspaceId),eq(valoReminderOutbox.id,id)));
    return"sent";
  });
}
/** Database outbox is durable; polling is only a wake-up, never an in-memory job queue. */
export async function reconcileDueReminders(){
  const due=await db.select({id:valoReminderOutbox.id,workspaceId:valoReminderOutbox.workspaceId}).from(valoReminderOutbox)
    .where(and(inArray(valoReminderOutbox.status,["pending","held"]),lte(valoReminderOutbox.scheduledAt,new Date()))).limit(25);
  for(const row of due)await processReminder(row.workspaceId,row.id);
  return{checked:due.length,providerCalls:0,emailConfigured:false};
}
