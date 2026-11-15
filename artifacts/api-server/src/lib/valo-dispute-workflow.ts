import {createHash,randomUUID} from "node:crypto";
import {and,desc,eq,inArray,sql} from "drizzle-orm";
import {db,valoOrders,valoEntitlements,valoPaymentDisputes,valoRefundRequests,valoEvents,valoPrivacyTombstones,
 valoPaymentConcerns,valoDisputeWorkflows,valoDisputeIntents,valoDisputeAudit,valoConcernMessages} from "@workspace/db";
import {CreatePaymentConcernBody,RespondPaymentConcernBody,ActOnPaymentConcernBody,LinkFinanceDisputeBody,ActOnFinanceDisputeBody} from "@workspace/api-zod";
import {authorizeWorkspaceWrite,ValoProblem,type WorkspaceActor} from "./valo-store";
import {assertFinanceActor,requireFinance,type FinanceActor} from "./valo-refunds";
import {refundBalance} from "./valo-refund-provider";
import {disputeTransport,disputeInformation,matchDispute,resolutionPayload,type DisputeTransport,type DisputeContext,type MerchantDecision} from "./valo-dispute-provider";
import {storeVerifiedDispute} from "./valo-payment-disputes";
import {assertRecoveryEffectsAllowed} from "./valo-recovery-effects";
import {consumeQuota,quotaSubjectHash} from "./valo-quota";
import {renderDisputeReceipt} from "./valo-dispute-receipt";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Order=typeof valoOrders.$inferSelect;
type Workflow=typeof valoDisputeWorkflows.$inferSelect;
type Intent=typeof valoDisputeIntents.$inferSelect;
type Concern=typeof valoPaymentConcerns.$inferSelect;
type Action=ReturnType<typeof ActOnFinanceDisputeBody.parse>;
function canonical(v:unknown):unknown{
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b,"en")).map(([k,value])=>[k,canonical(value)]));
 return v;
}
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const notice="Lists show the latest 100 records; concern threads show the latest 100 messages. Older saved messages remain available in the workspace export. Customer concerns are not bank disputes. Test-only provider execution is disabled unless explicitly configured. Acknowledgement means the provider received an action, not that the bank ruled in your favour. Existing access restrictions and financial history remain unchanged.";
const terminal=(s:string)=>["resolved","archived"].includes(s);
async function orderLock(tx:Tx,id:string,workspaceId?:string){
 const[o]=await tx.select().from(valoOrders).where(and(eq(valoOrders.id,id),...(workspaceId?[eq(valoOrders.workspaceId,workspaceId)]:[]))).for("update");
 if(!o)throw new ValoProblem(404,"Order not found.");return o;
}
async function workflowLock(tx:Tx,id:string){
 const[link]=await tx.select({orderId:valoDisputeWorkflows.orderId}).from(valoDisputeWorkflows).where(eq(valoDisputeWorkflows.id,id));
 if(!link)throw new ValoProblem(404,"Dispute workflow not found.");
 const order=await orderLock(tx,link.orderId);
 const[w]=await tx.select().from(valoDisputeWorkflows).where(eq(valoDisputeWorkflows.id,id)).for("update");
 if(!w)throw new ValoProblem(404,"Dispute workflow not found.");return{w,order};
}
function context(w:Pick<Workflow,"providerId">,o:Order):DisputeContext{
 if(!o.providerTransactionId||!["verified_success","reversed"].includes(o.status))throw new ValoProblem(409,"A verified transaction binding is required.");
 return{providerId:w.providerId,transactionId:o.providerTransactionId,reference:o.reference,amountKobo:o.amountKobo};
}
async function audit(tx:Tx,o:Order,actorType:"customer"|"finance"|"worker",actorId:string,action:string,reason:string,
 extra:{workflowId?:string;concernId?:string;intentId?:string;customerVisible?:boolean}={}){
 const id=randomUUID();await tx.insert(valoDisputeAudit).values({id,workspaceId:o.workspaceId,orderId:o.id,actorType,actorId,action,reason,...extra});return id;
}
const history=(r:typeof valoDisputeAudit.$inferSelect)=>({id:r.id,action:r.action,reason:r.reason,actorType:r.actorType,createdAt:r.createdAt.toISOString()});
async function concernView(tx:Tx,c:Concern){
 const[o]=await tx.select().from(valoOrders).where(eq(valoOrders.id,c.orderId));
 const events=await tx.select().from(valoDisputeAudit).where(and(eq(valoDisputeAudit.concernId,c.id),eq(valoDisputeAudit.customerVisible,true))).orderBy(desc(valoDisputeAudit.createdAt)).limit(100);
 const messages=await tx.select().from(valoConcernMessages).where(eq(valoConcernMessages.concernId,c.id));
 const byId=new Map(messages.map(m=>[m.id,m.body]));
 return{id:c.id,orderId:c.orderId,orderReference:o.reference,message:c.message,status:c.status,latestReply:c.latestReply,version:c.version,
 createdAt:c.createdAt.toISOString(),updatedAt:c.updatedAt.toISOString(),history:events.reverse().map(e=>({...history(e),reason:byId.get(e.id)??e.reason}))};
}
async function workflowView(tx:Tx,w:Workflow){
 const[o]=await tx.select().from(valoOrders).where(eq(valoOrders.id,w.orderId));
 const[e]=await tx.select({status:valoEntitlements.status}).from(valoEntitlements).where(eq(valoEntitlements.orderId,w.orderId));
 return{id:w.id,orderId:w.orderId,orderReference:o.reference,orderTitle:o.line.title,orderAmountKobo:o.amountKobo,providerId:w.providerId,
 canonicalStatus:w.canonicalStatus,providerResolution:w.providerResolution,providerAmountKobo:w.providerAmountKobo,category:w.category,
 entitlementStatus:e?.status??null,held:w.held,version:w.version,checkedAt:w.checkedAt.toISOString(),createdAt:w.createdAt.toISOString()};
}
function intentView(i:Intent){return{id:i.id,operation:i.operation,state:i.state,inputHash:i.inputHash,sourceReference:i.sourceReference,summary:i.summary,facts:i.facts,
 createdAt:i.createdAt.toISOString(),attemptedAt:i.attemptedAt?.toISOString()??null,acknowledgedAt:i.acknowledgedAt?.toISOString()??null,
 providerFilename:i.providerFilename,providerEvidenceId:i.providerEvidenceId,failure:i.failure,
 receiptUrl:i.operation==="receipt_upload"?`/api/admin/disputes/${i.workflowId}/receipt/${i.id}`:null};}
async function detail(tx:Tx,w:Workflow,enabled=disputeTransport.configured()){
 const intents=await tx.select().from(valoDisputeIntents).where(eq(valoDisputeIntents.workflowId,w.id)).orderBy(valoDisputeIntents.createdAt);
 const events=await tx.select().from(valoDisputeAudit).where(eq(valoDisputeAudit.workflowId,w.id)).orderBy(desc(valoDisputeAudit.createdAt)).limit(100);
 return{workflow:await workflowView(tx,w),intents:intents.map(intentView),history:events.reverse().map(history),executionEnabled:enabled,notice};
}
async function bump(tx:Tx,w:Workflow,values:Partial<typeof valoDisputeWorkflows.$inferInsert>={}){
 const[n]=await tx.update(valoDisputeWorkflows).set({...values,version:w.version+1}).where(eq(valoDisputeWorkflows.id,w.id)).returning();return n;
}
async function noErasure(tx:Tx,workspaceId:string){
 const[t]=await tx.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.workspaceId,workspaceId));
 if(t)throw new ValoProblem(409,"Workspace erasure is recorded. New dispute evidence cannot be sent.");
}
async function limitConcern(tx:Tx,actor:WorkspaceActor){
 const key=quotaSubjectHash(process.env.SESSION_SECRET,"user",actor.identityId);
 for(const[window,max]of[["minute",5],["day",30]]as const){const q=await consumeQuota(`payment-concern-${window}`,key,max,window,tx);
 if(!q.allowed)throw new ValoProblem(429,"Payment concern limit reached. Saved information is unchanged.",undefined,q.retryAfter);}
}
export async function createPaymentConcern(actor:WorkspaceActor,id:string,raw:unknown){
 const input=CreatePaymentConcernBody.strict().parse(raw),inputHash=hash({id,message:input.message});
 return db.transaction(async tx=>{
 const o=await orderLock(tx,id,actor.workspaceId);await authorizeWorkspaceWrite(tx,actor);
 const[old]=await tx.select().from(valoPaymentConcerns).where(and(eq(valoPaymentConcerns.workspaceId,actor.workspaceId),eq(valoPaymentConcerns.requestKey,input.requestKey)));
 if(old){if(old.inputHash!==inputHash)throw new ValoProblem(409,"This request key belongs to different concern details.");return concernView(tx,old);}
 await limitConcern(tx,actor);
 const[c]=await tx.insert(valoPaymentConcerns).values({id:randomUUID(),workspaceId:actor.workspaceId,orderId:id,requestKey:input.requestKey,inputHash,message:input.message}).returning();
 const eventId=await audit(tx,o,"customer",actor.identityId,"concern_created","Customer submitted a payment concern; no bank dispute was created.",{concernId:c.id,customerVisible:true});
 await tx.insert(valoConcernMessages).values({id:eventId,workspaceId:o.workspaceId,orderId:o.id,concernId:c.id,body:input.message});return concernView(tx,c);
 });
}
export async function respondPaymentConcern(actor:WorkspaceActor,id:string,raw:unknown){
 const input=RespondPaymentConcernBody.strict().parse(raw);
 return db.transaction(async tx=>{
 const[link]=await tx.select().from(valoPaymentConcerns).where(and(eq(valoPaymentConcerns.id,id),eq(valoPaymentConcerns.workspaceId,actor.workspaceId)));
 if(!link)throw new ValoProblem(404,"Concern not found.");const o=await orderLock(tx,link.orderId,actor.workspaceId);await authorizeWorkspaceWrite(tx,actor);
 const[c]=await tx.select().from(valoPaymentConcerns).where(eq(valoPaymentConcerns.id,id)).for("update");
 if(c.version!==input.expectedVersion||c.status==="closed")throw new ValoProblem(409,"Concern changed or is closed. Refresh before responding.");await limitConcern(tx,actor);
 const[n]=await tx.update(valoPaymentConcerns).set({status:"open",version:c.version+1,updatedAt:new Date()}).where(eq(valoPaymentConcerns.id,id)).returning();
 const eventId=await audit(tx,o,"customer",actor.identityId,"concern_information_added","Customer updated the concern information.",{concernId:id,customerVisible:true});
 await tx.insert(valoConcernMessages).values({id:eventId,workspaceId:o.workspaceId,orderId:o.id,concernId:id,body:input.message});return concernView(tx,n);
 });
}
export async function actOnPaymentConcern(actor:FinanceActor,id:string,raw:unknown){
 await assertFinanceActor(actor);const input=ActOnPaymentConcernBody.strict().parse(raw);
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
 await authorizeWorkspaceWrite(tx,actor);
 const cs=await tx.select().from(valoPaymentConcerns).where(eq(valoPaymentConcerns.workspaceId,actor.workspaceId)).orderBy(desc(valoPaymentConcerns.createdAt)).limit(100);
 const ws=await tx.select().from(valoDisputeWorkflows).where(eq(valoDisputeWorkflows.workspaceId,actor.workspaceId)).orderBy(desc(valoDisputeWorkflows.checkedAt)).limit(100);
 return{concerns:await Promise.all(cs.map(c=>concernView(tx,c))),workflows:await Promise.all(ws.map(w=>workflowView(tx,w))),notice};});}
export async function getFinanceDisputes(actor:FinanceActor){await assertFinanceActor(actor);return db.transaction(async tx=>{
 await requireFinance(tx,actor,"Read payment concerns and canonical dispute workflow queue; no customer documents.");
 const cs=await tx.select().from(valoPaymentConcerns).orderBy(desc(valoPaymentConcerns.updatedAt)).limit(100);
 const ws=await tx.select().from(valoDisputeWorkflows).orderBy(desc(valoDisputeWorkflows.checkedAt)).limit(100);
 const observations=await tx.select().from(valoPaymentDisputes).orderBy(desc(valoPaymentDisputes.checkedAt)).limit(100);
 return{concerns:await Promise.all(cs.map(c=>concernView(tx,c))),workflows:await Promise.all(ws.map(w=>workflowView(tx,w))),
 observations:observations.map(o=>({orderId:o.orderId,providerId:o.providerId,status:o.status,checkedAt:o.checkedAt.toISOString()})),executionEnabled:disputeTransport.configured(),notice};});}
export async function getFinanceDispute(actor:FinanceActor,id:string){await assertFinanceActor(actor);return db.transaction(async tx=>{
 const{w}=await workflowLock(tx,id);await requireFinance(tx,actor,"Read dispute intent and evidence acknowledgements.");return detail(tx,w);});}
function providerGate(provider:DisputeTransport,o:Order){
 assertRecoveryEffectsAllowed();
 if(provider!==disputeTransport&&(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT||process.env.VALO_RUN_DISPUTE_TESTS!=="synthetic-development-only"||!o.requestedBy.startsWith("synthetic-dispute-")))
 throw new ValoProblem(403,"Controlled adapters require owned synthetic development orders.");
 if(!provider.configured())throw new ValoProblem(503,"Merchant dispute execution is disabled. No provider action was sent.");
}
export async function linkFinanceDispute(actor:FinanceActor,raw:unknown,provider:DisputeTransport=disputeTransport){
 await assertFinanceActor(actor);const input=LinkFinanceDisputeBody.strict().parse(raw);
 const o=await db.transaction(async tx=>{const o=await orderLock(tx,input.orderId);await requireFinance(tx,actor,"Fetch canonical dispute for the exact selected order.");await noErasure(tx,o.workspaceId);return o;});
 providerGate(provider,o);const data=matchDispute(context(input,o),await provider.fetch(context(input,o)));
 const observation=await storeVerifiedDispute(input.providerId,data);
 return db.transaction(async tx=>{const locked=await orderLock(tx,o.id);await requireFinance(tx,actor,"Bind server-verified test dispute to selected order.");await noErasure(tx,o.workspaceId);
 const[old]=await tx.select().from(valoDisputeWorkflows).where(eq(valoDisputeWorkflows.providerId,input.providerId));if(old){if(old.orderId!==o.id)throw new ValoProblem(409,"Dispute already belongs to another order.");return detail(tx,old,provider.configured());}
 const[w]=await tx.insert(valoDisputeWorkflows).values({id:randomUUID(),workspaceId:o.workspaceId,orderId:o.id,disputeId:observation.id,providerId:input.providerId,
 canonicalStatus:observation.status,providerResolution:observation.resolution,providerAmountKobo:observation.amountKobo,category:data.category??null}).returning();
 await audit(tx,locked,"finance",actor.identityId,"canonical_dispute_linked","Server-fetched test dispute matched order, transaction, currency and paid amount.",{workflowId:w.id,customerVisible:true});return detail(tx,w,provider.configured());});
}
async function noUncertainIntent(tx:Tx,id:string,except?:string){
 const rows=await tx.select({id:valoDisputeIntents.id}).from(valoDisputeIntents).where(and(eq(valoDisputeIntents.workflowId,id),inArray(valoDisputeIntents.state,["dispatching","unknown","needs_review"])));
 if(rows.some(r=>r.id!==except))throw new ValoProblem(409,"A prior action has an uncertain outcome. Reconcile it before preparing or sending another action.");
}
async function acceptanceBalance(tx:Tx,o:Order,i:Intent){
 if(i.operation!=="resolve"||i.payload.resolution!=="merchant-accepted")return;
 if(o.status!=="verified_success")throw new ValoProblem(409,"A reversed or unverified payment cannot authorize additional compensation.");
 const refunds=await tx.select().from(valoRefundRequests).where(eq(valoRefundRequests.orderId,o.id));
 const others=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.orderId,o.id),eq(valoDisputeIntents.operation,"resolve")));
 const reserved=others.filter(x=>x.id!==i.id&&x.state!=="cancelled"&&x.payload.resolution==="merchant-accepted").reduce((sum,x)=>sum+Number(x.payload.amountKobo),0);
 if(Number(i.payload.amountKobo)>refundBalance(o.amountKobo,refunds).refundableKobo-reserved)
 throw new ValoProblem(409,"Pending, uncertain or completed refunds/dispute acceptances reserve this payment balance.");
}
async function prepare(tx:Tx,w:Workflow,o:Order,actor:FinanceActor,input:Action){
 if(!input.requestKey||input.acknowledgement!==true)throw new ValoProblem(422,"A stable request key and explicit factual acknowledgement are required.");
 if(w.held||w.canonicalStatus!=="awaiting-merchant-feedback")throw new ValoProblem(409,"Release the hold and reconcile a dispute awaiting merchant feedback before preparation.");await noErasure(tx,o.workspaceId);
 await noUncertainIntent(tx,w.id);
 const operation=input.action==="prepare_receipt"?"receipt_upload":input.action==="prepare_evidence"?"evidence":"resolve";
 // Replay the same exact submitted preparation; never render again or change its evidence.
 const {expectedVersion,...stableInput}=input;const requestHash=hash(stableInput);
 const[old]=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.workflowId,w.id),eq(valoDisputeIntents.requestKey,input.requestKey)));
 if(old){if(old.payload.requestHash!==requestHash)throw new ValoProblem(409,"This request key belongs to different prepared evidence.");return w;}
 const[active]=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.workflowId,w.id),eq(valoDisputeIntents.operation,operation),sql`${valoDisputeIntents.state}<>'cancelled'`));
 if(active)throw new ValoProblem(409,"This operation already has a saved intent. Reconcile it; a sent or uncertain action cannot be replaced.");
 let payload:Record<string,unknown>={requestHash},sourceReference=input.sourceNote??"",summary="",facts:{label:string;value:string}[]=[];
 const id=randomUUID();
 if(operation==="receipt_upload"){
 const[event]=await tx.select().from(valoEvents).where(and(eq(valoEvents.workspaceId,o.workspaceId),eq(valoEvents.entityId,o.id),inArray(valoEvents.action,["payment.verified_success","payment.synthetic_receipt_recovered"]))).limit(1);
 if(!event)throw new ValoProblem(409,"A retained verified purchase receipt event is required; do not invent missing purchase history.");
 const snapshot={reference:o.reference,transactionId:o.providerTransactionId!,amountKobo:o.amountKobo,title:o.line.title,createdAt:o.createdAt.toISOString(),taxTreatment:o.line.taxTreatment,licenceVersion:o.line.licenceVersion};
 const bytes=await renderDisputeReceipt(snapshot);if(bytes.length>2*1024*1024)throw new ValoProblem(409,"Receipt exceeds the supported evidence size.");
 sourceReference=`purchase-event:${event.id}`;summary="Server-generated test purchase receipt; not delivery or bank evidence.";
 payload={...payload,name:`valo-test-receipt-${id}.pdf`,bytes:bytes.toString("base64"),checksum:createHash("sha256").update(bytes).digest("hex"),snapshot};
 facts=[{label:"Order reference",value:o.reference},{label:"Transaction",value:o.providerTransactionId!},{label:"Paid amount (kobo)",value:String(o.amountKobo)}];
 }else if(operation==="evidence"){
 if(!input.sourceNote)throw new ValoProblem(422,"Identify the factual source of the submitted evidence.");
 const information=disputeInformation.parse(input.information);payload={...payload,information};summary="Finance-attested structured evidence; no generated delivery facts.";
 facts=Object.entries(information).map(([label,value])=>({label,value}));
 }else{
 const intents=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.workflowId,w.id),eq(valoDisputeIntents.state,"acknowledged")));
 const receipt=intents.find(i=>i.operation==="receipt_upload"),evidence=intents.find(i=>i.operation==="evidence");
 const decision:MerchantDecision={resolution:input.resolution!,amountKobo:input.amountKobo!,message:input.reason,
 ...(receipt?.providerFilename?{uploadedFilename:receipt.providerFilename}:{}),...(evidence?.providerEvidenceId?{evidenceId:evidence.providerEvidenceId}:{})};
 resolutionPayload(decision,o.amountKobo);
 if(w.category==="fraud"&&decision.resolution==="declined"&&!decision.evidenceId)throw new ValoProblem(409,"Defending a fraud claim requires acknowledged structured evidence.");
 payload={...payload,...decision};sourceReference=`canonical-dispute:${w.providerId}; receipt:${receipt?.id??"none"}; evidence:${evidence?.id??"none"}`;
 summary=decision.resolution==="merchant-accepted"?"Accept the stated refund amount; no separate refund request is sent.":"Decline with acknowledged receipt/evidence; no bank victory is claimed.";
 facts=[{label:"Resolution",value:decision.resolution},{label:"Refund amount (kobo)",value:String(decision.amountKobo)},{label:"Message",value:decision.message}];
 }
 const[i]=await tx.insert(valoDisputeIntents).values({id,workspaceId:o.workspaceId,orderId:o.id,workflowId:w.id,requestKey:input.requestKey,operation,
 inputHash:hash(payload),payload,sourceReference,summary,facts,authorisedBy:actor.identityId}).returning();
 await acceptanceBalance(tx,o,i);
 await audit(tx,o,"finance",actor.identityId,"intent_prepared",input.reason,{workflowId:w.id,intentId:i.id});return bump(tx,w);
}
export async function actOnFinanceDispute(actor:FinanceActor,id:string,raw:unknown,provider:DisputeTransport=disputeTransport){
 await assertFinanceActor(actor);const input=ActOnFinanceDisputeBody.strict().parse(raw);
 if(input.action==="reconcile"){await reconcileDisputeWorkflow(id,provider,actor,input.expectedVersion);return getFinanceDispute(actor,id);}
 if(input.action==="dispatch_intent"){
 if(!input.intentId||input.acknowledgement!==true)throw new ValoProblem(422,"Explicit acknowledgement of the saved intent is required.");
 await dispatchDisputeIntent(actor,id,input.intentId,input.expectedVersion,provider);return getFinanceDispute(actor,id);
 }
 return db.transaction(async tx=>{const{w,order}=await workflowLock(tx,id);await requireFinance(tx,actor,`Dispute ${input.action}: ${input.reason}`);
 if(input.action.startsWith("prepare_")&&input.requestKey){
 const[existing]=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.workflowId,id),eq(valoDisputeIntents.requestKey,input.requestKey)));
 if(existing){const{expectedVersion,...stableInput}=input;if(existing.payload.requestHash!==hash(stableInput))throw new ValoProblem(409,"This request key belongs to different prepared evidence.");return detail(tx,w,provider.configured());}}
 if(w.version!==input.expectedVersion)throw new ValoProblem(409,"Dispute changed. Refresh its saved intent before acting.");let next=w;
 if(input.action==="hold"||input.action==="release_hold"){
 if(input.action==="release_hold")await noErasure(tx,order.workspaceId);
 next=await bump(tx,w,{held:input.action==="hold"});await audit(tx,order,"finance",actor.identityId,input.action,input.reason,{workflowId:id});
 }else if(input.action==="cancel_intent"){
 const[i]=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.id,input.intentId??"00000000-0000-0000-0000-000000000000"),eq(valoDisputeIntents.workflowId,id))).for("update");
 if(!i||i.state!=="prepared")throw new ValoProblem(409,"Only an unsent prepared intent may be cancelled.");
 await tx.update(valoDisputeIntents).set({state:"cancelled"}).where(eq(valoDisputeIntents.id,i.id));next=await bump(tx,w);await audit(tx,order,"finance",actor.identityId,"intent_cancelled",input.reason,{workflowId:id,intentId:i.id});
 }else next=await prepare(tx,w,order,actor,input);
 return detail(tx,next,provider.configured());});
}
/** Staff alone dispatches. Workers only GET/reconcile. A persisted attempt can
 * never return to prepared, including when a process dies before transmission. */
export async function dispatchDisputeIntent(actor:FinanceActor,id:string,intentId:string,expectedVersion:number,provider:DisputeTransport=disputeTransport){
 await assertFinanceActor(actor);
 const claim=await db.transaction(async tx=>{const{w,order}=await workflowLock(tx,id);await requireFinance(tx,actor,"Dispatch previously acknowledged dispute intent once.");
 providerGate(provider,order);await noErasure(tx,order.workspaceId);
 if(w.version!==expectedVersion||w.held||w.canonicalStatus!=="awaiting-merchant-feedback")throw new ValoProblem(409,"Dispute changed, is held, or is no longer actionable.");
 const[i]=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.id,intentId),eq(valoDisputeIntents.workflowId,id))).for("update");
 if(!i||i.state!=="prepared"||i.attempts!==0||i.inputHash!==hash(i.payload))throw new ValoProblem(409,"Intent is not an unchanged, unsent preparation. Reconcile rather than retry.");
 await noUncertainIntent(tx,id);await acceptanceBalance(tx,order,i);const token=randomUUID();
 await tx.update(valoDisputeIntents).set({state:"dispatching",attempts:1,attemptedAt:new Date(),leaseToken:token,leaseUntil:new Date(Date.now()+60000)}).where(eq(valoDisputeIntents.id,intentId));
 await audit(tx,order,"finance",actor.identityId,"dispatch_reserved","One provider attempt reserved durably before any outbound mutation.",{workflowId:id,intentId});await bump(tx,w);
 return{i,w,order,token};});
 // This callback runs in the real adapter AFTER canonical GET/upload URL lookup
 // and immediately BEFORE the mutation, closing an authority/hold await gap.
 const beforeSend=async()=>db.transaction(async tx=>{const{w,order}=await workflowLock(tx,id);await requireFinance(tx,actor,"Recheck current authority immediately before dispute transmission.");
 providerGate(provider,order);await noErasure(tx,order.workspaceId);
 const[i]=await tx.select().from(valoDisputeIntents).where(eq(valoDisputeIntents.id,intentId)).for("update");
 if(w.held||w.canonicalStatus!=="awaiting-merchant-feedback"||hash(context(w,order))!==hash(context(claim.w,claim.order))||i.state!=="dispatching"||i.leaseToken!==claim.token||!i.leaseUntil||i.leaseUntil.getTime()<=Date.now())throw new ValoProblem(409,"Dispute dispatch is held, expired or superseded.");
 await noUncertainIntent(tx,id,intentId);await acceptanceBalance(tx,order,i);
 });
 let receipt:{filename?:string;evidenceId?:string;checksum?:string}={};
 try{
 const c=context(claim.w,claim.order);
 if(claim.i.operation==="receipt_upload")receipt=await provider.upload(c,String(claim.i.payload.name),Buffer.from(String(claim.i.payload.bytes),"base64"),beforeSend);
 else if(claim.i.operation==="evidence")receipt=await provider.evidence(c,claim.i.payload.information,beforeSend);
 else{const{requestHash,...decision}=claim.i.payload;await provider.resolve(c,decision as MerchantDecision,beforeSend);}
 if(claim.i.operation==="receipt_upload"&&receipt.checksum!==claim.i.payload.checksum)throw Error("RECEIPT_CHECKSUM_MISMATCH");
 await db.transaction(async tx=>{const{w,order}=await workflowLock(tx,id);const[i]=await tx.select().from(valoDisputeIntents).where(eq(valoDisputeIntents.id,intentId)).for("update");
 if(i.state!=="dispatching"||i.leaseToken!==claim.token)return;
 await tx.update(valoDisputeIntents).set({state:"acknowledged",leaseToken:null,leaseUntil:null,acknowledgedAt:new Date(),providerFilename:receipt.filename??null,providerEvidenceId:receipt.evidenceId??null,failure:null}).where(eq(valoDisputeIntents.id,intentId));
 await audit(tx,order,"finance",actor.identityId,"provider_acknowledged","The provider acknowledged this exact saved action; no bank outcome inferred.",{workflowId:id,intentId});await bump(tx,w);});
 }catch{
 await db.transaction(async tx=>{const{w,order}=await workflowLock(tx,id);const[i]=await tx.select().from(valoDisputeIntents).where(eq(valoDisputeIntents.id,intentId)).for("update");
 if(i.state!=="dispatching"||i.leaseToken!==claim.token)return;
 await tx.update(valoDisputeIntents).set({state:"unknown",leaseToken:null,leaseUntil:null,failure:"No durable provider acknowledgement. Reconcile canonical state; never resend automatically."}).where(eq(valoDisputeIntents.id,intentId));
 await audit(tx,order,"worker","service:dispute-workflow","dispatch_uncertain","A prepared action may have reached the provider. Automatic mutation retry is forbidden.",{workflowId:id,intentId});await bump(tx,w);});
 }
}
/** GET-only recovery. Expired dispatches become unknown even when provider
 * execution is disabled; their attempts are never put back into a send queue. */
export async function reconcileDisputeWorkflow(id:string,provider:DisputeTransport=disputeTransport,actor?:FinanceActor,expectedVersion?:number){
 if(actor)await assertFinanceActor(actor);
 const initial=await db.transaction(async tx=>{const{w,order}=await workflowLock(tx,id);
 if(actor)await requireFinance(tx,actor,"Reconcile canonical dispute without resending mutations.");
 if(expectedVersion!==undefined&&w.version!==expectedVersion)throw new ValoProblem(409,"Dispute changed. Refresh before reconciling.");
 const stale=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.workflowId,id),eq(valoDisputeIntents.state,"dispatching"),sql`${valoDisputeIntents.leaseUntil}<=now()`)).for("update");
 let next=w;for(const i of stale){await tx.update(valoDisputeIntents).set({state:"unknown",leaseToken:null,leaseUntil:null,failure:"Dispatch process stopped without a durable acknowledgement; only canonical GET reconciliation is allowed."}).where(eq(valoDisputeIntents.id,i.id));
 await audit(tx,order,"worker","service:dispute-workflow","abandoned_dispatch","Expired dispatch fenced; no automatic mutation retry.",{workflowId:id,intentId:i.id});}
 if(stale.length)next=await bump(tx,w);return{w:next,order};});
 if(!provider.configured())return;
 providerGate(provider,initial.order);const data=matchDispute(context(initial.w,initial.order),await provider.fetch(context(initial.w,initial.order)));
 const observed=await storeVerifiedDispute(initial.w.providerId,data);
 await db.transaction(async tx=>{const{w,order}=await workflowLock(tx,id);if(actor)await requireFinance(tx,actor,"Record server-fetched canonical dispute reconciliation.");
 const intents=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.workflowId,id),inArray(valoDisputeIntents.state,["unknown","needs_review"]))).for("update");
 for(const i of intents){
 // No documented receipt-upload/evidence idempotency lookup can prove those
 // outcomes. A generic terminal status cannot prove a particular decision.
 const exact=i.operation==="resolve"&&data.resolution===i.payload.resolution&&data.refund_amount===i.payload.amountKobo&&
 (data.resolution==="merchant-accepted"||data.resolution==="declined")&&data.status!=="awaiting-merchant-feedback";
 if(exact){await tx.update(valoDisputeIntents).set({state:"reconciled",failure:"Canonical GET confirms the matching resolution and refund amount. The original transmission receipt remains unknown; this is not a bank verdict."}).where(eq(valoDisputeIntents.id,i.id));
 await audit(tx,order,"worker","service:dispute-workflow","canonical_effect_reconciled","Canonical GET matches the intended financial effect; the original transmission acknowledgement is not proven and no bank verdict is inferred.",{workflowId:id,intentId:i.id});
 }else if(i.state!=="needs_review")await tx.update(valoDisputeIntents).set({state:"needs_review",failure:"Canonical GET does not prove this exact action. Keep it reserved and inspect the merchant record; do not resend."}).where(eq(valoDisputeIntents.id,i.id));
 }
 await bump(tx,w,{canonicalStatus:observed.status,providerResolution:observed.resolution,providerAmountKobo:observed.amountKobo,category:data.category??w.category,checkedAt:new Date()});
 await audit(tx,order,actor?"finance":"worker",actor?.identityId??"service:dispute-workflow","canonical_reconciled","Current provider observation recorded. Saved drafts and existing access restrictions were preserved.",{workflowId:id,customerVisible:true});
 });
}
export async function reconcileDisputeWorkflows(){
 const rows=await db.select({id:valoDisputeWorkflows.id}).from(valoDisputeWorkflows)
 .where(sql`${valoDisputeWorkflows.checkedAt}<now()-interval '1 hour' OR EXISTS (SELECT 1 FROM valo_dispute_intents i WHERE i.workflow_id=${valoDisputeWorkflows.id} AND i.state='dispatching' AND i.lease_until<=now())`).limit(10);
 for(const r of rows){try{await reconcileDisputeWorkflow(r.id);}catch{/* Last verified state and reservations remain; never infer a success or retry. */}}
}
export async function financeDisputeReceipt(actor:FinanceActor,id:string,intentId:string){
 await assertFinanceActor(actor);return db.transaction(async tx=>{const{w}=await workflowLock(tx,id);await requireFinance(tx,actor,"Download the immutable prepared financial receipt; no customer draft content.");
 const[i]=await tx.select().from(valoDisputeIntents).where(and(eq(valoDisputeIntents.id,intentId),eq(valoDisputeIntents.workflowId,w.id)));
 if(!i||i.operation!=="receipt_upload"||i.inputHash!==hash(i.payload))throw new ValoProblem(404,"Prepared receipt not found.");
 return Buffer.from(String(i.payload.bytes),"base64");});
}
