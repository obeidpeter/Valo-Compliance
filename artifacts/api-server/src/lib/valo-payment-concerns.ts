import {createHash,randomUUID} from "node:crypto";
import {and,desc,eq,inArray} from "drizzle-orm";
import {db,valoOrders,valoPrivacyTombstones,valoPaymentConcerns,valoConcernMessages,valoPaymentConcernEvents} from "@workspace/db";
import {CreatePaymentConcernBody,RespondPaymentConcernBody,ActOnPaymentConcernBody} from "@workspace/api-zod";
import {authorizeWorkspaceWrite,limitWorkspaceWrite,ValoProblem,type WorkspaceActor} from "./valo-store";
import {assertFinanceActor,requireFinance,type FinanceActor} from "./valo-refunds";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Order=typeof valoOrders.$inferSelect;
type Concern=typeof valoPaymentConcerns.$inferSelect;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const notice="A customer payment concern does not create a bank dispute. Lists and threads show the latest 100 records; earlier saved messages remain in your workspace export. No messages are emailed from this workflow.";
async function orderLock(tx:Tx,id:string,workspaceId?:string){
 const[o]=await tx.select().from(valoOrders).where(and(eq(valoOrders.id,id),...(workspaceId?[eq(valoOrders.workspaceId,workspaceId)]:[]))).for("update");
 if(!o)throw new ValoProblem(404,"Order not found.");return o;
}
async function audit(tx:Tx,o:Order,actorType:"customer"|"finance"|"worker",actorId:string,action:string,reason:string,
 extra:{concernId:string;customerVisible?:boolean}){
 const id=randomUUID();await tx.insert(valoPaymentConcernEvents).values({id,workspaceId:o.workspaceId,orderId:o.id,actorType,actorId,action,reason,...extra});return id;
}
const history=(r:typeof valoPaymentConcernEvents.$inferSelect)=>({id:r.id,action:r.action,reason:r.reason,actorType:r.actorType,createdAt:r.createdAt.toISOString()});
async function concernView(tx:Tx,c:Concern){
 const[o]=await tx.select().from(valoOrders).where(eq(valoOrders.id,c.orderId));
 const events=await tx.select().from(valoPaymentConcernEvents).where(and(eq(valoPaymentConcernEvents.concernId,c.id),eq(valoPaymentConcernEvents.customerVisible,true))).orderBy(desc(valoPaymentConcernEvents.createdAt)).limit(100);
 const messages=events.length?await tx.select().from(valoConcernMessages).where(inArray(valoConcernMessages.id,events.map(e=>e.id))):[];
 const byId=new Map(messages.map(m=>[m.id,m.body]));
 return{id:c.id,orderId:c.orderId,orderReference:o.reference,message:c.message,status:c.status,latestReply:c.latestReply,version:c.version,
 createdAt:c.createdAt.toISOString(),updatedAt:c.updatedAt.toISOString(),history:events.reverse().map(e=>({...history(e),reason:byId.get(e.id)??e.reason}))};
}
async function noErasure(tx:Tx,workspaceId:string){
 const[t]=await tx.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.workspaceId,workspaceId));
 if(t)throw new ValoProblem(409,"Workspace erasure is recorded. New dispute evidence cannot be sent.");
}
export async function createPaymentConcern(actor:WorkspaceActor,id:string,raw:unknown){
 const input=CreatePaymentConcernBody.strict().parse(raw);input.message=input.message.trim();if(input.message.length<20)throw new ValoProblem(422,"Describe the concern in at least 20 characters.");const inputHash=hash({id,message:input.message});
 return db.transaction(async tx=>{
 const o=await orderLock(tx,id,actor.workspaceId);await authorizeWorkspaceWrite(tx,actor);
 const[old]=await tx.select().from(valoPaymentConcerns).where(and(eq(valoPaymentConcerns.workspaceId,actor.workspaceId),eq(valoPaymentConcerns.requestKey,input.requestKey)));
 if(old){if(old.inputHash!==inputHash)throw new ValoProblem(409,"This request key belongs to different concern details.");return concernView(tx,old);}
 await limitWorkspaceWrite(tx,actor,"support");
 const[c]=await tx.insert(valoPaymentConcerns).values({id:randomUUID(),workspaceId:actor.workspaceId,orderId:id,requestKey:input.requestKey,inputHash,message:input.message}).returning();
 const eventId=await audit(tx,o,"customer",actor.identityId,"concern_created","Customer submitted a payment concern; no bank dispute was created.",{concernId:c.id,customerVisible:true});
 await tx.insert(valoConcernMessages).values({id:eventId,workspaceId:o.workspaceId,orderId:o.id,concernId:c.id,body:input.message});return concernView(tx,c);
 });
}
export async function respondPaymentConcern(actor:WorkspaceActor,id:string,raw:unknown){
 const input=RespondPaymentConcernBody.strict().parse(raw);input.message=input.message.trim();if(input.message.length<10)throw new ValoProblem(422,"Provide at least 10 characters of information.");
 return db.transaction(async tx=>{
 const[link]=await tx.select().from(valoPaymentConcerns).where(and(eq(valoPaymentConcerns.id,id),eq(valoPaymentConcerns.workspaceId,actor.workspaceId)));
 if(!link)throw new ValoProblem(404,"Concern not found.");const o=await orderLock(tx,link.orderId,actor.workspaceId);await authorizeWorkspaceWrite(tx,actor);
 const[c]=await tx.select().from(valoPaymentConcerns).where(eq(valoPaymentConcerns.id,id)).for("update");
 if(c.version!==input.expectedVersion||c.status==="closed")throw new ValoProblem(409,"Concern changed or is closed. Refresh before responding.");await limitWorkspaceWrite(tx,actor,"support");
 const[n]=await tx.update(valoPaymentConcerns).set({status:"open",version:c.version+1,updatedAt:new Date()}).where(eq(valoPaymentConcerns.id,id)).returning();
 const eventId=await audit(tx,o,"customer",actor.identityId,"concern_information_added","Customer updated the concern information.",{concernId:id,customerVisible:true});
 await tx.insert(valoConcernMessages).values({id:eventId,workspaceId:o.workspaceId,orderId:o.id,concernId:id,body:input.message});return concernView(tx,n);
 });
}
export async function actOnPaymentConcern(actor:FinanceActor,id:string,raw:unknown){
 await assertFinanceActor(actor);const input=ActOnPaymentConcernBody.strict().parse(raw);input.message=input.message.trim();if(input.message.length<10)throw new ValoProblem(422,"Provide a meaningful customer response.");
 return db.transaction(async tx=>{
 const[link]=await tx.select().from(valoPaymentConcerns).where(eq(valoPaymentConcerns.id,id));if(!link)throw new ValoProblem(404,"Concern not found.");
 const o=await orderLock(tx,link.orderId);await requireFinance(tx,actor,"Respond to customer payment concern.");await noErasure(tx,o.workspaceId);
 const[c]=await tx.select().from(valoPaymentConcerns).where(eq(valoPaymentConcerns.id,id)).for("update");
 if(c.version!==input.expectedVersion||c.status==="closed")throw new ValoProblem(409,"Concern changed or is closed. Refresh before responding.");
 const status=input.action==="close"?"closed":input.action==="request_information"?"needs_information":"responded";
 const[n]=await tx.update(valoPaymentConcerns).set({latestReply:input.message,status,version:c.version+1,updatedAt:new Date()}).where(eq(valoPaymentConcerns.id,id)).returning();
 const eventId=await audit(tx,o,"finance",actor.identityId,`concern_${input.action}`,"Finance updated the customer-visible response and concern status.",{concernId:id,customerVisible:true});
 await tx.insert(valoConcernMessages).values({id:eventId,workspaceId:o.workspaceId,orderId:o.id,concernId:id,body:input.message});return concernView(tx,n);
 });
}

export async function getWorkspaceDisputes(actor:WorkspaceActor){return db.transaction(async tx=>{
 await authorizeWorkspaceWrite(tx,actor);const rows=await tx.select().from(valoPaymentConcerns).where(eq(valoPaymentConcerns.workspaceId,actor.workspaceId)).orderBy(desc(valoPaymentConcerns.updatedAt)).limit(100);
 return{concerns:await Promise.all(rows.map(row=>concernView(tx,row))),notice};});}
export async function getFinancePaymentConcerns(actor:FinanceActor){await assertFinanceActor(actor);return db.transaction(async tx=>{
 await requireFinance(tx,actor,"Read customer payment concerns; no private document bodies.");
 const rows=await tx.select().from(valoPaymentConcerns).orderBy(desc(valoPaymentConcerns.updatedAt)).limit(100);
 return{concerns:await Promise.all(rows.map(row=>concernView(tx,row))),notice};});}
