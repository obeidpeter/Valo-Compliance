import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {fork} from "node:child_process";
import {and,eq,sql} from "drizzle-orm";
import {db,pool,valoDisputeIntents,valoDisputeWorkflows,valoDisputeAudit,valoStaffAssignments,valoOrders,valoEntitlements,valoRefundRequests,valoConcernMessages} from "@workspace/db";
import {disputeFixture} from "./valo-dispute-workflow-fixture";
import {makeDisputeTransport} from "./valo-dispute-provider";
import {createPaymentConcern,respondPaymentConcern,actOnPaymentConcern,getWorkspaceDisputes,linkFinanceDispute,getFinanceDispute,actOnFinanceDispute,dispatchDisputeIntent,reconcileDisputeWorkflow,financeDisputeReceipt,reconcileDisputeWorkflows} from "./valo-dispute-workflow";
import {requestOrderRefund} from "./valo-refunds";
import {workspaceDataExport} from "./valo-customer-access";
const action=(expectedVersion:number,kind:string,extra:Record<string,unknown>={})=>({expectedVersion,action:kind,reason:"Controlled factual finance action for this test order.",...extra});
const information={customer_email:"synthetic@example.invalid",customer_name:"Controlled fixture",customer_phone:"0000000000",service_details:"Synthetic purchase record, no invented delivery assertion."};
test("durable dispute workflow: real PostgreSQL with the actual controlled adapter, no merchant",{timeout:120000},async t=>{
 assert.equal(process.env.NODE_ENV,"development");assert.ok(!process.env.PAYSTACK_SECRET_KEY);assert.ok(!process.env.REPLIT_DEPLOYMENT);process.env.VALO_RUN_DISPUTE_TESTS="synthetic-development-only";
 async function linked(){const f=await disputeFixture();const d=await linkFinanceDispute(f.staff,{orderId:f.order.id,providerId:f.providerId},f.provider);return{...f,d};}
 async function prepared(f:Awaited<ReturnType<typeof linked>>,kind="prepare_decision",extra:Record<string,unknown>={}){
 return actOnFinanceDispute(f.staff,f.d.workflow.id,action(f.d.workflow.version,kind,{requestKey:randomUUID(),acknowledgement:true,resolution:"merchant-accepted",amountKobo:3000,...extra}),f.provider);}
 try{
 await t.test("tenant-bound concern preserves all messages and never creates a bank dispute",async()=>{
 const f=await disputeFixture(),input={requestKey:randomUUID(),message:"Controlled customer payment concern, not a bank dispute.",acknowledgement:true};
 await assert.rejects(createPaymentConcern(f.other,f.order.id,input),{status:404});const c=await createPaymentConcern(f.owner,f.order.id,input);
 assert.deepEqual(await createPaymentConcern(f.owner,f.order.id,input),c);await assert.rejects(createPaymentConcern(f.owner,f.order.id,{...input,message:"A different controlled question for the same key."}),{status:409});
 const reply=await actOnPaymentConcern(f.staff,c.id,{expectedVersion:c.version,action:"request_information",message:"Please clarify the purchase concern without sending any private document."});
 const next=await respondPaymentConcern(f.owner,c.id,{expectedVersion:reply.version,message:"Here is the requested synthetic purchase clarification."});
 assert.equal(next.message,input.message);assert.equal(next.history.length,3);assert.ok(next.history.some(h=>h.reason===reply.latestReply));assert.ok(next.history.some(h=>h.reason.includes("requested synthetic")));
 assert.equal((await getWorkspaceDisputes(f.other)).concerns.length,0);assert.equal((await getWorkspaceDisputes(f.owner)).workflows.length,0);
 const exported=JSON.stringify(await workspaceDataExport(f.owner));assert.ok(exported.includes("requested synthetic"));assert.ok(!exported.includes("leaseToken"));assert.equal(f.counters().gets,0);
 });
 await t.test("canonical exact order binding rejects cross-order IDs and unverified input",async()=>{
 const f=await disputeFixture();const bad=makeDisputeTransport(async()=>({...f.canonical,transaction:{...f.canonical.transaction,reference:"another-order"}}),f.upload,()=>true);
 await assert.rejects(linkFinanceDispute(f.staff,{orderId:f.order.id,providerId:f.providerId},bad),{status:409});
 await assert.rejects(linkFinanceDispute({...f.staff,recentMfa:false},{orderId:f.order.id,providerId:f.providerId},f.provider),{status:403});
 await assert.rejects(linkFinanceDispute(f.staff,{orderId:f.order.id,providerId:f.providerId,canonical:f.canonical},f.provider));assert.equal(f.counters().puts,0);
 });
 await t.test("JSONB roundtrip, same-key response loss and concurrent dispatch create one acknowledged action",async()=>{
 const f=await linked(),input=action(f.d.workflow.version,"prepare_decision",{requestKey:randomUUID(),acknowledgement:true,resolution:"merchant-accepted",amountKobo:3000});
 const d=await actOnFinanceDispute(f.staff,f.d.workflow.id,input,f.provider);assert.deepEqual(await actOnFinanceDispute(f.staff,f.d.workflow.id,input,f.provider),d);
 await assert.rejects(actOnFinanceDispute(f.staff,f.d.workflow.id,{...input,amountKobo:3001},f.provider),{status:409});
 const i=d.intents[0];const results=await Promise.allSettled([dispatchDisputeIntent(f.staff,d.workflow.id,i.id,d.workflow.version,f.provider),dispatchDisputeIntent(f.staff,d.workflow.id,i.id,d.workflow.version,f.provider)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.counters().puts,1);
 const saved=await getFinanceDispute(f.staff,d.workflow.id);assert.equal(saved.intents[0].state,"acknowledged");
 await assert.rejects(dispatchDisputeIntent(f.staff,d.workflow.id,i.id,saved.workflow.version,f.provider),{status:409});
 assert.equal((await db.select().from(valoOrders).where(eq(valoOrders.id,f.order.id)))[0].status,"verified_success");
 assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,f.order.id)))[0].status,"suspended");
 });
 await t.test("server receipt PDF and evidence acknowledgements are persisted before a fraud decline",async()=>{
 const f=await linked();let d=await prepared(f,"prepare_receipt",{resolution:undefined,amountKobo:undefined});
 const receipt=d.intents[0];const bytes=await financeDisputeReceipt(f.staff,d.workflow.id,receipt.id);assert.equal(bytes.subarray(0,5).toString(),"%PDF-");assert.ok(bytes.length>100);
 await dispatchDisputeIntent(f.staff,d.workflow.id,receipt.id,d.workflow.version,f.provider);d=await getFinanceDispute(f.staff,d.workflow.id);assert.equal(d.intents[0].providerFilename,"controlled-receipt.pdf");
 d=await actOnFinanceDispute(f.staff,d.workflow.id,action(d.workflow.version,"prepare_evidence",{requestKey:randomUUID(),acknowledgement:true,sourceNote:"Controlled synthetic source record supplied by finance.",information}),f.provider);
 const evidence=d.intents.find(i=>i.operation==="evidence")!;await dispatchDisputeIntent(f.staff,d.workflow.id,evidence.id,d.workflow.version,f.provider);d=await getFinanceDispute(f.staff,d.workflow.id);
 assert.equal(d.intents.find(i=>i.operation==="evidence")!.providerEvidenceId,"8123");
 d=await actOnFinanceDispute(f.staff,d.workflow.id,action(d.workflow.version,"prepare_decision",{requestKey:randomUUID(),acknowledgement:true,resolution:"declined",amountKobo:0}),f.provider);
 const decision=d.intents.find(i=>i.operation==="resolve")!;await dispatchDisputeIntent(f.staff,d.workflow.id,decision.id,d.workflow.version,f.provider);
 assert.deepEqual({...f.counters(),gets:0},{posts:1,puts:1,uploads:1,gets:0});
 const[data]=await db.select().from(valoDisputeIntents).where(eq(valoDisputeIntents.id,decision.id));assert.equal(data.payload.uploadedFilename,"controlled-receipt.pdf");assert.equal(data.payload.evidenceId,"8123");
 await assert.rejects(db.execute(sql`UPDATE valo_dispute_intents SET payload='{}'::jsonb WHERE id=${decision.id}::uuid`));
 await assert.rejects(db.execute(sql`DELETE FROM valo_dispute_audit WHERE intent_id=${decision.id}::uuid`));
 });
 await t.test("disabled dispatch has no reservation or transmission; hold and stale MFA deny",async()=>{
 const f=await linked(),d=await prepared(f),i=d.intents[0];
 await assert.rejects(dispatchDisputeIntent(f.staff,d.workflow.id,i.id,d.workflow.version),{status:503});
 assert.equal((await getFinanceDispute(f.staff,d.workflow.id)).intents[0].state,"prepared");
 await assert.rejects(dispatchDisputeIntent({...f.staff,verifiedAt:Date.now()-300001},d.workflow.id,i.id,d.workflow.version,f.provider),{status:403});
 const held=await actOnFinanceDispute(f.staff,d.workflow.id,action(d.workflow.version,"hold"),f.provider);
 await assert.rejects(dispatchDisputeIntent(f.staff,d.workflow.id,i.id,held.workflow.version,f.provider),{status:409});assert.equal(f.counters().puts,0);
 });
 await t.test("role/hold/canonical changes during provider GET are rechecked before outbound mutation",async()=>{
 for(const change of["role","hold","canonical","reversal"]){const f=await linked(),d=await prepared(f);let ready!:()=>void,release!:()=>void;
 const reached=new Promise<void>(r=>{ready=r;}),barrier=new Promise<void>(r=>{release=r;});
 const adapter=makeDisputeTransport(async(path,body,method)=>{if(!method||method==="GET"){const value=await f.api(path,body,method);ready();await barrier;return value;}return f.api(path,body,method);},f.upload,()=>true);
 const running=dispatchDisputeIntent(f.staff,d.workflow.id,d.intents[0].id,d.workflow.version,adapter);await reached;
 if(change==="role")await db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.id,f.role));
 else if(change==="reversal")await db.update(valoOrders).set({status:"reversed"}).where(eq(valoOrders.id,f.order.id));
 else await db.update(valoDisputeWorkflows).set(change==="hold"?{held:true}:{canonicalStatus:"resolved"}).where(eq(valoDisputeWorkflows.id,d.workflow.id));
 release();await running;assert.equal(f.counters().puts,0);
 const[i]=await db.select().from(valoDisputeIntents).where(eq(valoDisputeIntents.id,d.intents[0].id));assert.equal(i.state,"unknown");assert.equal(i.attempts,1);
 }
 });
 await t.test("unknown transmission never retries; canonical financial effect is distinct from original acknowledgement",async()=>{
 const f=await linked(),d=await prepared(f);const timeout=makeDisputeTransport(async(path,body,method)=>{const result=await f.api(path,body,method);if(method==="PUT")throw Error("controlled acknowledgement lost");return result;},f.upload,()=>true);
 await dispatchDisputeIntent(f.staff,d.workflow.id,d.intents[0].id,d.workflow.version,timeout);let state=await getFinanceDispute(f.staff,d.workflow.id);assert.equal(state.intents[0].state,"unknown");
 await assert.rejects(actOnFinanceDispute(f.staff,d.workflow.id,action(state.workflow.version,"prepare_evidence",{requestKey:randomUUID(),acknowledgement:true,sourceNote:"Controlled source record for synthetic test",information}),f.provider),{status:409});
 await reconcileDisputeWorkflow(d.workflow.id,f.provider);state=await getFinanceDispute(f.staff,d.workflow.id);assert.equal(state.intents[0].state,"reconciled");assert.equal(state.intents[0].acknowledgedAt,null);assert.match(state.intents[0].failure!,/original transmission receipt remains unknown/);assert.equal(f.counters().puts,1);
 await reconcileDisputeWorkflow(d.workflow.id,f.provider);assert.equal(f.counters().puts,1);
 });
 await t.test("refund reservations and uncertain acceptances cannot compensate twice",async()=>{
 const reversed=await linked();await db.update(valoOrders).set({status:"reversed"}).where(eq(valoOrders.id,reversed.order.id));
 await assert.rejects(prepared(reversed),{status:409});
 const f=await disputeFixture();await requestOrderRefund(f.owner,f.order.id,{reason:"Controlled pending partial refund reserves balance",requestKey:randomUUID(),amountKobo:8000,acceptedPolicyVersion:"test-refund-v1"});
 const d=await linkFinanceDispute(f.staff,{orderId:f.order.id,providerId:f.providerId},f.provider);
 await assert.rejects(actOnFinanceDispute(f.staff,d.workflow.id,action(d.workflow.version,"prepare_decision",{requestKey:randomUUID(),acknowledgement:true,resolution:"merchant-accepted",amountKobo:3000}),f.provider),{status:409});
 const accepted=await actOnFinanceDispute(f.staff,d.workflow.id,action(d.workflow.version,"prepare_decision",{requestKey:randomUUID(),acknowledgement:true,resolution:"merchant-accepted",amountKobo:2000}),f.provider);
 f.canonical.status="resolved";f.canonical.resolution="declined";f.canonical.refund_amount=0;await reconcileDisputeWorkflow(d.workflow.id,f.provider);
 await assert.rejects(requestOrderRefund(f.owner,f.order.id,{reason:"A second request must not bypass dispute reservation",requestKey:randomUUID(),amountKobo:1000,acceptedPolicyVersion:"test-refund-v1"}),{status:409});assert.equal(accepted.intents.length,1);
 });
 await t.test("SIGKILL after provider mutation leaves durable unknown recovery and never resends",async()=>{
 const f=await linked(),d=await prepared(f),child=fork(new URL("./valo-dispute-workflow-crash.ts",import.meta.url),[],{env:{...process.env,VALO_DISPUTE_CRASH:JSON.stringify({id:d.workflow.id,intentId:d.intents[0].id,expectedVersion:d.workflow.version,actor:f.staff,canonical:f.canonical})},stdio:["ignore","ignore","pipe","ipc"],execArgv:["--import","tsx"]});
 let stderr="";child.stderr?.on("data",c=>{stderr+=String(c);});
 try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("controlled crash barrier timeout "+stderr.slice(-1000))),15000);child.once("message",()=>{clearTimeout(timer);resolve();});child.once("exit",code=>{if(code!==null)reject(Error("child exited before mutation "+stderr.slice(-1000)));});});
 child.kill("SIGKILL");await new Promise<void>(resolve=>child.once("exit",()=>resolve()));
 await db.update(valoDisputeIntents).set({leaseUntil:new Date(0)}).where(eq(valoDisputeIntents.id,d.intents[0].id));
 await reconcileDisputeWorkflows();let state=await getFinanceDispute(f.staff,d.workflow.id);assert.equal(state.intents[0].state,"unknown");
 f.canonical.status="awaiting-bank-feedback";f.canonical.resolution="merchant-accepted";f.canonical.refund_amount=3000;
 await reconcileDisputeWorkflow(d.workflow.id,f.provider);state=await getFinanceDispute(f.staff,d.workflow.id);assert.equal(state.intents[0].state,"reconciled");assert.equal(f.counters().puts,0);
 const[i]=await db.select().from(valoDisputeIntents).where(eq(valoDisputeIntents.id,d.intents[0].id));assert.equal(i.attempts,1);
 }finally{if(child.exitCode===null)child.kill("SIGKILL");}
 });
 }finally{await pool.end();}
});
