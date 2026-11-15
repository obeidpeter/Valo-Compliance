import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {fork,spawnSync} from "node:child_process";
import express from "express";
import {GetFinanceDisputeResponse} from "@workspace/api-zod";
import {eq,and} from "drizzle-orm";
import {db,pool,valoOrders,valoPrices,valoEntitlements,valoPurchaseOutbox,valoStaffAssignments,
  valoDisputeActions,valoDisputeTransitions,valoPaymentDisputes,valoRefundRequests,valoPaymentConcerns,valoConcernMessages,valoPaymentConcernEvents,valoSupportTickets} from "@workspace/db";
import {resolveWorkspace,ValoProblem} from "./valo-store";
import {financeHeldFixture} from "./valo-finance-test-fixture";
import {storeVerifiedDispute} from "./valo-payment-disputes";
import {makeDisputeTransport} from "./valo-dispute-provider";
import {saveDisputeInformation,orderDisputeInformation,prepareDisputeAction,controlDisputeAction,financeDispute,renderPurchaseReceipt,cancelUnsentDisputeWork,holdFinanceDispute,linkFinanceDispute,reconcileDisputeActions} from "./valo-dispute-actions";
import {createPaymentConcern,respondPaymentConcern,actOnPaymentConcern,getWorkspaceDisputes} from "./valo-payment-concerns";
import {eraseSupportContentBatch,closePrivacyErasureLocks} from "./valo-privacy-erasure";
import {workspaceDataExport} from "./valo-customer-access";
import {makeDisputeOperationsRouter} from "../routes/valo-customer-access";

test("durable dispute intents: development PostgreSQL, controlled PSP and actual receipt PDF",{
  skip:process.env.VALO_RUN_DISPUTE_TESTS!=="synthetic-development-only",timeout:120000,
},async t=>{
  assert.equal(process.env.NODE_ENV,"development");assert.ok(!process.env.REPLIT_DEPLOYMENT);
  const owner=await resolveWorkspace("synthetic-dispute-"+randomUUID()),other=await resolveWorkspace("synthetic-dispute-"+randomUUID());
  const actor={identityId:"synthetic-finance-"+randomUUID(),recentMfa:true,verifiedAt:Date.now()},role=randomUUID();
  await db.insert(valoStaffAssignments).values({id:role,identityId:actor.identityId,role:"finance",grantedBy:"controlled-test",reason:"Owned synthetic fixture only"});
  const held=await financeHeldFixture(),price=randomUUID();
  await db.insert(valoPrices).values({id:price,contentVersionId:held.id,title:"CONTROLLED DISPUTE FIXTURE — NOT RELEASED",
    amountKobo:10000,licenceVersion:"test-only",licenceText:"No live commercial approval.",taxTreatment:"No tax claim.",
    approvalReference:"CONTROLLED_FIXTURE_NOT_APPROVAL",effectiveFrom:new Date()});
  const canonical=new Map<string,Record<string,unknown>>(),calls:{method:string;path:string;body:unknown}[]=[];
  let serial=Number.parseInt(randomUUID().replaceAll("-","").slice(0,10),16),stamp=0,timeoutResolve=false,uploadCalls=0;
  const pdf=Buffer.from("%PDF-1.7\nControlled transport fixture only\n%%EOF");
  const p=makeDisputeTransport(async(path,body,method="GET")=>{
    calls.push({method,path,body});const id=path.split("/")[2],d=canonical.get(id)!;
    if(path.includes("upload_url"))return{signedUrl:"https://s3.eu-west-1.amazonaws.com/files.paystack.co/owned?X-Amz-Date=20261114T115900Z&X-Amz-Expires=1800",fileName:"provider-receipt-"+id};
    if(method==="POST"){const data={...(body as object),id:++serial,dispute:id};d.evidence=data;
      d.updatedAt=new Date(Date.parse("2026-11-14T12:00:00Z")+(++stamp)*1000).toISOString();return data;}
    if(method==="PUT"){Object.assign(d,{status:"resolved",resolution:(body as Record<string,unknown>).resolution,
      refund_amount:(body as Record<string,unknown>).refund_amount,updatedAt:new Date(Date.parse("2026-11-14T12:00:00Z")+(++stamp)*1000).toISOString()});
      if(timeoutResolve)throw Error("Controlled timeout after merchant response was accepted");return d;}
    return structuredClone(d);
  },(async(_url,init)=>{uploadCalls++;assert.equal(new Headers(init?.headers).has("Authorization"),false);
    assert.equal(Buffer.from(init!.body as Uint8Array).subarray(0,5).toString(),"%PDF-");
    const providerId=calls.at(-1)!.path.split("/")[2];
    const[d]=await db.select().from(valoPaymentDisputes).where(eq(valoPaymentDisputes.providerId,providerId));
    const[planned]=await db.select().from(valoDisputeActions).where(and(eq(valoDisputeActions.disputeId,d.id),
      eq(valoDisputeActions.kind,"upload_receipt"),eq(valoDisputeActions.status,"dispatching")));
    assert.equal(planned.result!.filename,"provider-receipt-"+providerId);
    assert.ok(planned.result!.attemptChecksum,"exact upload checksum is durable before object PUT");
    return new Response(null,{status:204});}) as typeof fetch,
  ()=>true,()=>Date.parse("2026-11-14T12:00:00Z"));
  let concernActor=owner;
  async function fixture(status="awaiting-merchant-feedback",category="general",customer=owner){
    const order=randomUUID(),providerId=String(++serial),transactionId=String(++serial);
    await db.insert(valoOrders).values({id:order,workspaceId:customer.workspaceId,requestedBy:customer.identityId,requestKey:randomUUID(),priceId:price,
      reference:"valo-test-"+order,amountKobo:10000,status:"verified_success",providerTransactionId:transactionId,
      line:{title:"Controlled purchase",contentVersionId:held.id,licenceVersion:"test-only",licenceText:"No live commercial approval.",taxTreatment:"No tax claim."}});
    await db.insert(valoEntitlements).values({id:randomUUID(),workspaceId:customer.workspaceId,orderId:order,contentVersionId:held.id});
    await db.insert(valoPurchaseOutbox).values({id:randomUUID(),workspaceId:customer.workspaceId,orderId:order});
    const raw={id:providerId,domain:"test",status,resolution:null,refund_amount:null,currency:"NGN",category,
      updatedAt:new Date(Date.parse("2026-11-14T12:00:00Z")+(++stamp)*1000).toISOString(),
      transaction:{id:transactionId,domain:"test",reference:"valo-test-"+order,amount:10000,currency:"NGN"}};
    canonical.set(providerId,raw);const d=await storeVerifiedDispute(providerId,raw);return{order,d,raw};
  }
  const input=(kind:"upload_receipt"|"submit_evidence"|"merchant_decision",rest:object={})=>({kind,requestKey:randomUUID(),message:"Controlled finance message; no invented delivery.",...rest});
  async function action(f:Awaited<ReturnType<typeof fixture>>,kind:"upload_receipt"|"submit_evidence"|"merchant_decision",rest:object={}){
    const view=await prepareDisputeAction(actor,f.d.id,input(kind,rest));return view.actions.find(a=>a.kind===kind&&a.status!=="cancelled")!;
  }
  async function row(id:string){return(await db.select().from(valoDisputeActions).where(eq(valoDisputeActions.id,id)))[0];}
  try{
    await t.test("terminal/archived observations alone do not suspend or restore access",async()=>{
      const f=await fixture("archived");
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,f.order)))[0].status,"active");
      canonical.get(f.d.providerId)!.updatedAt=new Date(Date.parse(String(f.raw.updatedAt))-1000).toISOString();
      canonical.get(f.d.providerId)!.status="awaiting-merchant-feedback";
      assert.equal((await storeVerifiedDispute(f.d.providerId,canonical.get(f.d.providerId))).status,"archived");
    });
    await t.test("actual HTTP read/prepare checks finance permission, fresh MFA and hostile origins",async()=>{
      const f=await fixture();let sessionActor=actor;
      const app=express();app.use(express.json());app.use(makeDisputeOperationsRouter(async()=>sessionActor));
      app.use((e:unknown,_r:express.Request,res:express.Response,_n:express.NextFunction)=>res.status(e instanceof ValoProblem?e.status:422).json({error:"controlled-safe-error"}));
      const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
      const address=server.address() as {port:number},base="http://127.0.0.1:"+address.port,old=process.env.VALO_TRUSTED_ORIGIN;
      process.env.VALO_TRUSTED_ORIGIN=base;
      try{
        const read=await fetch(base+"/admin/disputes/"+f.d.id);assert.equal(read.status,200);assert.match(read.headers.get("Cache-Control")! ,/no-store/);
        sessionActor={...actor,recentMfa:false};assert.equal((await fetch(base+"/admin/disputes/"+f.d.id)).status,403);
        sessionActor={...actor,identityId:other.identityId};assert.equal((await fetch(base+"/admin/disputes/"+f.d.id)).status,403);
        sessionActor=actor;
        const body=input("upload_receipt");
        assert.equal((await fetch(base+"/admin/disputes/"+f.d.id+"/actions",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://hostile.invalid"},body:JSON.stringify(body)})).status,403);
        const prepared=await fetch(base+"/admin/disputes/"+f.d.id+"/actions",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify(body)});
        assert.equal(prepared.status,201);
        const data=GetFinanceDisputeResponse.parse(await prepared.json());assert.equal(data.actions[0].status,"prepared");
      }finally{if(old===undefined)delete process.env.VALO_TRUSTED_ORIGIN;else process.env.VALO_TRUSTED_ORIGIN=old;
        await new Promise<void>(r=>server.close(()=>r()));}
    });
    await t.test("customer statements are selected-order scoped, consented, exact and retry-safe",async()=>{
      const f=await fixture(),body={disputeId:f.d.id,requestKey:randomUUID(),customerName:"Explicit synthetic customer",
        customerPhone:"08000000000",serviceDetails:"Customer states the actual controlled service circumstances.",consentVersion:"test-dispute-information-v1"};
      await assert.rejects(()=>saveDisputeInformation(other,"other@example.invalid",f.order,body),{status:404});
      const first=await saveDisputeInformation(owner,"fixture@example.invalid",f.order,body);
      assert.equal((await saveDisputeInformation(owner,"fixture@example.invalid",f.order,body)).information.length,1);
      await assert.rejects(()=>saveDisputeInformation(owner,"fixture@example.invalid",f.order,{...body,customerName:"Changed"}),{status:409});
      const stored=first.information[0];assert.equal(stored.information.customer_email,"fixture@example.invalid");
      assert.equal("delivery_date" in stored.information,false);
      const evidence=await action(f,"submit_evidence",{informationId:stored.id});
      await controlDisputeAction(actor,evidence.id,"execute",{acknowledgement:true,expectedVersion:1},p,async()=>pdf);
      assert.equal((await row(evidence.id)).status,"acknowledged");
      assert.ok((await row(evidence.id)).result?.evidenceId);
      await assert.rejects(()=>orderDisputeInformation(other,f.order),{status:404});
    });
    await t.test("real generated purchase PDF is readable and uploaded once under racing clicks",async()=>{
      const f=await fixture(),a=await action(f,"upload_receipt");
      const order=(await db.select().from(valoOrders).where(eq(valoOrders.id,f.order)))[0],bytes=await renderPurchaseReceipt(order);
      const extracted=spawnSync("pdftotext",["-","-"],{input:bytes,encoding:"utf8",maxBuffer:100000});
      assert.equal(extracted.error,undefined,"The independent pdftotext reader must be installed; no PDF-read pass is inferred without it.");
      assert.equal(extracted.status,0);assert.match(extracted.stdout,/Original amount NGN 100.00/);
      assert.ok(extracted.stdout.includes(order.reference));assert.match(extracted.stdout,/Not proof of delivery/);
      const before=uploadCalls;
      await Promise.all([controlDisputeAction(actor,a.id,"execute",{acknowledgement:true,expectedVersion:1},p,async()=>bytes),
        controlDisputeAction(actor,a.id,"execute",{acknowledgement:true,expectedVersion:1},p,async()=>bytes)]);
      assert.equal(uploadCalls,before+1);assert.equal((await row(a.id)).attempts,1);
      assert.ok((await row(a.id)).result?.checksum);
      await assert.rejects(async()=>controlDisputeAction(actor,a.id,"cancel",{acknowledgement:true,expectedVersion:(await row(a.id)).version},p),{status:409});
    });
    await t.test("timeout after acceptance remains unknown, is never re-sent and reconciles exact merchant state",async()=>{
      const f=await fixture(),body=input("merchant_decision",{resolution:"merchant-accepted",amountKobo:4500});
      const prepared=await prepareDisputeAction(actor,f.d.id,body),a=prepared.actions[0];
      assert.equal((await prepareDisputeAction(actor,f.d.id,body)).actions[0].id,a.id);
      await assert.rejects(()=>prepareDisputeAction(actor,f.d.id,{...body,amountKobo:4501}),{status:409});
      timeoutResolve=true;const before=calls.filter(c=>c.method==="PUT").length;
      await controlDisputeAction(actor,a.id,"execute",{acknowledgement:true,expectedVersion:1},p);
      assert.equal((await row(a.id)).status,"unknown");
      await controlDisputeAction(actor,a.id,"execute",{acknowledgement:true,expectedVersion:1},p);
      assert.equal(calls.filter(c=>c.method==="PUT").length,before+1);
      timeoutResolve=false;
      await controlDisputeAction(actor,a.id,"reconcile",{acknowledgement:true,expectedVersion:(await row(a.id)).version},p);
      assert.equal((await row(a.id)).status,"observed");
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,f.order)))[0].status,"suspended");
      const observation=(await row(a.id)).result!.observation;
      assert.match(observation,/Matching merchant financial effect seen in canonical state/);
      assert.match(observation,/original transmission acknowledgement and final bank outcome are not inferred/);
    });
    await t.test("fraud decline binds the acknowledged receipt and exact customer evidence before preparation",async()=>{
      const f=await fixture("awaiting-merchant-feedback","fraud");
      await assert.rejects(()=>action(f,"merchant_decision",{resolution:"declined",amountKobo:0}),{status:422});
      const upload=await action(f,"upload_receipt");
      await controlDisputeAction(actor,upload.id,"execute",{acknowledgement:true,expectedVersion:1},p,async()=>pdf);
      await assert.rejects(()=>action(f,"merchant_decision",{resolution:"declined",amountKobo:0}),{status:422});
      const info=await saveDisputeInformation(owner,"fixture@example.invalid",f.order,{disputeId:f.d.id,requestKey:randomUUID(),
        customerName:"Explicit synthetic customer",customerPhone:"08000000000",serviceDetails:"Customer-provided controlled circumstances.",
        consentVersion:"test-dispute-information-v1"});
      const e=await action(f,"submit_evidence",{informationId:info.information[0].id});
      await controlDisputeAction(actor,e.id,"execute",{acknowledgement:true,expectedVersion:1},p);
      const decision=await action(f,"merchant_decision",{resolution:"declined",amountKobo:0});
      await controlDisputeAction(actor,decision.id,"execute",{acknowledgement:true,expectedVersion:1},p);
      const put=calls.filter(c=>c.method==="PUT"&&c.path==="/dispute/"+f.d.providerId+"/resolve").at(-1)!;
      const body=put.body as Record<string,unknown>;
      assert.equal(body.uploaded_filename,(await row(upload.id)).result!.filename);
      assert.equal(String(body.evidence),(await row(e.id)).result!.evidenceId);assert.equal(body.refund_amount,0);
      assert.equal((await row(decision.id)).status,"acknowledged","HTTP acknowledgement is not final bank success");
    });
    await t.test("unknown terminal/null resolution, mismatched and stale state cannot establish success",async()=>{
      const f=await fixture(),a=await action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:10000});
      await db.update(valoDisputeActions).set({status:"dispatching",attempts:1,updatedAt:new Date(0)}).where(eq(valoDisputeActions.id,a.id));
      Object.assign(canonical.get(f.d.providerId)!,{status:"archived",resolution:null,updatedAt:new Date(Date.parse(String(f.raw.updatedAt))+1000).toISOString()});
      await controlDisputeAction(actor,a.id,"reconcile",{acknowledgement:true,expectedVersion:1},p);
      assert.equal((await row(a.id)).status,"unknown");assert.equal((await row(a.id)).failure,"CANONICAL_OUTCOME_UNRESOLVED");
      const d=canonical.get(f.d.providerId)!;d.transaction={...(d.transaction as object),reference:"foreign-order"};
      await controlDisputeAction(actor,a.id,"reconcile",{acknowledgement:true,expectedVersion:(await row(a.id)).version},p);
      assert.equal((await row(a.id)).status,"unknown");
    });
    await t.test("revocation before dispatch cancels safely, preserving the immutable financial trail",async()=>{
      const f=await fixture(),a=await action(f,"upload_receipt"),before=uploadCalls;
      await assert.rejects(()=>controlDisputeAction(actor,a.id,"execute",{acknowledgement:true,expectedVersion:1},p,async()=>{
        await db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.id,role));return pdf;
      }),{status:403});
      assert.equal(uploadCalls,before);assert.equal((await row(a.id)).status,"cancelled");assert.equal((await row(a.id)).failure,"NOT_DISPATCHED");
      await db.update(valoStaffAssignments).set({active:true}).where(eq(valoStaffAssignments.id,role));
      const[h]=await db.select().from(valoDisputeTransitions).where(eq(valoDisputeTransitions.actionId,a.id));
      await assert.rejects(()=>db.update(valoDisputeTransitions).set({status:"tampered"}).where(eq(valoDisputeTransitions.id,h.id)));
    });
    await t.test("a pre-existing uncertain refund cannot be spent again by a merchant acceptance",async()=>{
      const f=await fixture();
      await db.insert(valoRefundRequests).values({id:randomUUID(),workspaceId:owner.workspaceId,orderId:f.order,reason:"Synthetic uncertain prior refund",
        reference:"vr-test-"+randomUUID(),amountKobo:9000,status:"unknown",policyVersion:"test-refund-v1"});
      await assert.rejects(()=>action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:2000}),{status:409});
      const a=await action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:1000}),before=calls.length;
      await assert.rejects(()=>controlDisputeAction(actor,a.id,"execute",{acknowledgement:true,expectedVersion:1},p),{status:409});
      assert.equal(calls.length,before);assert.equal((await row(a.id)).status,"prepared");
    });
    await t.test("altered source records and stale finance MFA cannot dispatch a prepared decision",async()=>{
      const f=await fixture(),a=await action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:1000}),before=calls.length;
      await assert.rejects(()=>controlDisputeAction({...actor,verifiedAt:Date.now()-300001},a.id,"execute",{acknowledgement:true,expectedVersion:1},p),{status:403});
      const[original]=await db.select().from(valoOrders).where(eq(valoOrders.id,f.order));
      try{
        // Fault injection into this newly owned synthetic row, not a repair.
        await db.update(valoOrders).set({line:{...original.line,title:"Altered fixture source"}}).where(eq(valoOrders.id,f.order));
        await assert.rejects(()=>controlDisputeAction(actor,a.id,"execute",{acknowledgement:true,expectedVersion:1},p),{status:409});
        assert.equal(calls.length,before);assert.equal((await row(a.id)).attempts,0);
      }finally{await db.update(valoOrders).set({line:original.line}).where(eq(valoOrders.id,f.order));}
      const u=await fixture(),held=await action(u,"merchant_decision",{resolution:"merchant-accepted",amountKobo:1000});
      canonical.get(u.d.providerId)!.category="unverified-classification";
      const puts=calls.filter(c=>c.method==="PUT").length;
      await controlDisputeAction(actor,held.id,"execute",{acknowledgement:true,expectedVersion:1},p);
      assert.equal((await row(held.id)).status,"cancelled");assert.equal((await row(held.id)).failure,"NO_MUTATION_DISPATCHED");
      assert.equal(calls.filter(c=>c.method==="PUT").length,puts,"a preflight refusal is not a merchant decision");
    });
    await t.test("unsent cancellation and privacy fencing preserve unknown liabilities",async()=>{
      const f=await fixture(),a=await action(f,"upload_receipt"),before=calls.length;
      await controlDisputeAction(actor,a.id,"cancel",{acknowledgement:true,expectedVersion:1},p);
      assert.equal((await row(a.id)).status,"cancelled");assert.equal(calls.length,before);
      const next=await action(f,"upload_receipt");assert.notEqual(next.id,a.id);
      const unknown=await db.select().from(valoDisputeActions).where(and(eq(valoDisputeActions.workspaceId,owner.workspaceId),eq(valoDisputeActions.status,"unknown")));
      assert.ok((await db.transaction(tx=>cancelUnsentDisputeWork(tx,owner.workspaceId))).rowCount>0);
      assert.equal((await row(next.id)).failure,"PRIVACY_WORKSPACE_FENCED");
      for(const u of unknown)assert.equal((await row(u.id)).status,"unknown");
    });
    await t.test("standalone customer concerns retain thread text, tenant privacy and safe exported financial status",async()=>{
      concernActor=await resolveWorkspace("synthetic-dispute-concern-"+randomUUID());
      const f=await fixture("awaiting-merchant-feedback","general",concernActor),input={requestKey:randomUUID(),message:"A separate synthetic customer payment concern, not a bank dispute.",acknowledgement:true};
      await assert.rejects(createPaymentConcern(other,f.order,input),{status:404});const c=await createPaymentConcern(concernActor,f.order,input);
      assert.deepEqual(await createPaymentConcern(concernActor,f.order,input),c);
      await assert.rejects(createPaymentConcern(concernActor,f.order,{...input,message:"Different synthetic details cannot reuse this concern key."}),{status:409});
      const reply=await actOnPaymentConcern(actor,c.id,{expectedVersion:c.version,action:"request_information",message:"Please clarify this payment concern without sharing a private document."});
      const next=await respondPaymentConcern(concernActor,c.id,{expectedVersion:reply.version,message:"Requested synthetic payment clarification is now provided."});
      assert.equal(next.message,input.message);assert.equal(next.history.length,3);assert.ok(next.history.some(x=>x.reason===reply.latestReply));
      assert.equal((await getWorkspaceDisputes(other)).concerns.length,0);
      await action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:1000});
      const exported=await workspaceDataExport(concernActor);assert.ok(JSON.stringify(exported).includes("Requested synthetic payment clarification"));
      const rows=exported.data.disputeIntents as Record<string,unknown>[];assert.ok(rows.length>0,"projection exercises a persisted financial intent");assert.ok(rows.every(x=>!("claimToken" in x)&&!("authorisedBy" in x)&&!("payload" in x)));
    });
    await t.test("saved action requires separate acknowledgement, hold revision and immutable payload",async()=>{
      const f=await fixture(),a=await action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:1000});
      await assert.rejects(controlDisputeAction(actor,a.id,"execute",{expectedVersion:1},p),{status:422});
      await assert.rejects(db.update(valoDisputeActions).set({payload:{message:"Changed saved financial intent"}}).where(eq(valoDisputeActions.id,a.id)));
      const view=await financeDispute(actor,f.d.id),held=await holdFinanceDispute(actor,f.d.id,{expectedVersion:view.controlVersion,held:true,reason:"Controlled dispute hold before transmission."});
      await assert.rejects(controlDisputeAction(actor,a.id,"execute",{expectedVersion:1,acknowledgement:true},p),{status:409});
      await assert.rejects(holdFinanceDispute(actor,f.d.id,{expectedVersion:view.controlVersion,held:false,reason:"Stale hold revision must not release."}),{status:409});
      await holdFinanceDispute(actor,f.d.id,{expectedVersion:held.controlVersion,held:false,reason:"Explicit current release of a controlled hold."});
      const linked=await linkFinanceDispute(actor,{orderId:f.order,providerId:f.d.providerId},p);assert.equal(linked.id,f.d.id);
      const wrong=await fixture();await assert.rejects(linkFinanceDispute(actor,{orderId:wrong.order,providerId:f.d.providerId},p),{status:409});
    });
    await t.test("role, hold, reversal and canonical changes during actual adapter GET deny every mutation",async()=>{
      for(const change of["role","hold","reversed","canonical","completed_refund"]){
        const f=await fixture(),a=await action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:1000});let ready!:()=>void,release!:()=>void,mutations=0;
        const reached=new Promise<void>(r=>{ready=r;}),barrier=new Promise<void>(r=>{release=r;});
        const provider=makeDisputeTransport(async(_path,_body,method)=>{if(!method||method==="GET"){const current=structuredClone(f.raw);ready();await barrier;return current;}mutations++;return{};},async()=>{throw Error("UNEXPECTED_UPLOAD");},()=>true);
        const running=controlDisputeAction(actor,a.id,"execute",{expectedVersion:1,acknowledgement:true},provider);const settled=running.then(()=>null,e=>e);await reached;
        if(change==="role")await db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.id,role));
        if(change==="hold")await holdFinanceDispute(actor,f.d.id,{expectedVersion:1,held:true,reason:"Hold committed while canonical lookup was waiting."});
        if(change==="reversed")await db.update(valoOrders).set({status:"reversed"}).where(eq(valoOrders.id,f.order));
        if(change==="canonical")await db.update(valoPaymentDisputes).set({status:"resolved"}).where(eq(valoPaymentDisputes.id,f.d.id));
        if(change==="completed_refund")await db.insert(valoRefundRequests).values({id:randomUUID(),workspaceId:owner.workspaceId,orderId:f.order,
          reason:"Controlled historical completed refund with later failed observation",status:"failed",completedAt:new Date(),
          amountKobo:10000,requestKey:randomUUID(),reference:"vr-test-"+randomUUID(),policyVersion:"test-refund-v1"});
        release();await settled;assert.equal(mutations,0);assert.equal((await row(a.id)).status,"cancelled");
        await db.update(valoStaffAssignments).set({active:true}).where(eq(valoStaffAssignments.id,role));
      }
    });
    await t.test("a disabled preflight after receipt rendering is provably unsent, not an unknown liability",async()=>{
      const f=await fixture(),a=await action(f,"upload_receipt");let enabled=true,requests=0;
      const provider=makeDisputeTransport(async()=>{requests++;return f.raw;},async()=>{throw Error("UNEXPECTED_UPLOAD");},()=>enabled);
      await controlDisputeAction(actor,a.id,"execute",{expectedVersion:1,acknowledgement:true},provider,async()=>{enabled=false;return pdf;});
      assert.equal(requests,0);assert.equal((await row(a.id)).status,"cancelled");assert.equal((await row(a.id)).failure,"NO_MUTATION_DISPATCHED");
    });
    await t.test("support, concern and message erasure share 100 rows without skipping a family",async()=>{
      const fresh=await resolveWorkspace("synthetic-dispute-erasure-"+randomUUID());
      // This owned workspace needs a financial parent solely for tenant FKs.
      const order=randomUUID();await db.insert(valoOrders).values({id:order,workspaceId:fresh.workspaceId,requestedBy:fresh.identityId,requestKey:randomUUID(),priceId:price,reference:"valo-test-"+order,amountKobo:10000,line:{title:"Owned erasure test",contentVersionId:held.id,licenceVersion:"synthetic",licenceText:"No sale",taxTreatment:"No tax assertion"}});
      await db.insert(valoSupportTickets).values({id:randomUUID(),workspaceId:fresh.workspaceId,category:"general",scope:"Sensitive controlled support content",contactEmail:"synthetic@example.invalid",sharingConsent:false,consentVersion:"synthetic"});
      const cs=Array.from({length:101},()=>({id:randomUUID(),workspaceId:fresh.workspaceId,orderId:order,requestKey:randomUUID(),inputHash:"a".repeat(64),message:"Sensitive controlled concern content",latestReply:"Sensitive controlled response"}));await db.insert(valoPaymentConcerns).values(cs);
      const events=cs.map(c=>({id:randomUUID(),workspaceId:fresh.workspaceId,orderId:order,concernId:c.id,actorType:"customer",actorId:fresh.identityId,action:"concern_created",reason:"Metadata only",customerVisible:true}));await db.insert(valoPaymentConcernEvents).values(events);
      await db.insert(valoConcernMessages).values(events.map(e=>({id:e.id,workspaceId:e.workspaceId,orderId:order,concernId:e.concernId,body:"Sensitive controlled thread message"})));
      const counts=[];for(let n=0;n<4;n++){const result=await db.transaction(tx=>eraseSupportContentBatch(tx,fresh.workspaceId));counts.push(result.rowCount);if(result.rowCount<100)break;}
      assert.deepEqual(counts,[100,100,3]);assert.equal((await db.select().from(valoConcernMessages).where(eq(valoConcernMessages.workspaceId,fresh.workspaceId))).length,0);
      const after=await db.select().from(valoPaymentConcerns).where(eq(valoPaymentConcerns.workspaceId,fresh.workspaceId));assert.ok(after.every(c=>c.message.includes("removed by verified workspace erasure")&&c.latestReply===null));
      assert.ok((await getWorkspaceDisputes(concernActor)).concerns.some(c=>c.message.includes("separate synthetic")),"other workspace content unchanged");
      assert.equal((await db.select().from(valoPaymentConcernEvents).where(eq(valoPaymentConcernEvents.workspaceId,fresh.workspaceId))).length,101,"immutable metadata remains");
    });
    await t.test("awaiting canonical labels cannot establish an observed financial decision",async()=>{
      const f=await fixture(),a=await action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:1000});
      await db.update(valoDisputeActions).set({status:"unknown",attempts:1,updatedAt:new Date(0)}).where(eq(valoDisputeActions.id,a.id));
      Object.assign(canonical.get(f.d.providerId)!,{resolution:"merchant-accepted",refund_amount:1000,updatedAt:new Date(Date.parse("2026-11-14T12:00:00Z")+(++stamp)*1000).toISOString()});
      await controlDisputeAction(actor,a.id,"reconcile",{expectedVersion:1},p);assert.equal((await row(a.id)).status,"unknown");
      await assert.rejects(prepareDisputeAction(actor,f.d.id,input("upload_receipt")),{status:409});
    });
    await t.test("SIGKILL after controlled provider mutation recovers by GET without resending",async()=>{
      const f=await fixture(),a=await action(f,"merchant_decision",{resolution:"merchant-accepted",amountKobo:1000});
      const child=fork(new URL("./valo-dispute-action-crash.ts",import.meta.url),[],{env:{...process.env,VALO_DISPUTE_CRASH:JSON.stringify({id:a.id,actor,canonical:f.raw})},execArgv:["--import","tsx"],stdio:["ignore","ignore","pipe","ipc"]});let stderr="";child.stderr?.on("data",c=>{stderr+=String(c);});
      try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Crash barrier not reached "+stderr.slice(-1000))),15000);child.once("message",()=>{clearTimeout(timer);resolve();});child.once("exit",()=>{clearTimeout(timer);reject(Error("Crash child exited early "+stderr.slice(-1000)));});});
      const exit=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGKILL");await exit;
      assert.equal((await row(a.id)).status,"dispatching");await db.update(valoDisputeActions).set({leaseUntil:new Date(0)}).where(eq(valoDisputeActions.id,a.id));
      await reconcileDisputeActions();assert.equal((await row(a.id)).status,"unknown");assert.equal((await row(a.id)).claimToken,null);
      await assert.rejects(prepareDisputeAction(actor,f.d.id,input("upload_receipt")),{status:409});
      await db.update(valoDisputeActions).set({updatedAt:new Date(0)}).where(eq(valoDisputeActions.id,a.id));
      Object.assign(canonical.get(f.d.providerId)!,{status:"resolved",resolution:"merchant-accepted",refund_amount:1000,updatedAt:new Date(Date.parse("2026-11-14T12:00:00Z")+(++stamp)*1000).toISOString()});
      const mutations=calls.filter(c=>c.method!=="GET").length;await reconcileDisputeActions(p);const observed=await row(a.id);assert.equal(observed.status,"observed");assert.equal(observed.attempts,1);assert.equal(calls.filter(c=>c.method!=="GET").length,mutations);
      assert.match(String(observed.result?.observation),/original transmission receipt/);
      }finally{if(child.exitCode===null)child.kill("SIGKILL");}
    });
    console.log(JSON.stringify({realMerchantCalls:0,externalMessages:0,actualPdfReader:"pdftotext",syntheticFinancialHistoryRetained:true}));
  }finally{
    await db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.id,role));
    await closePrivacyErasureLocks();await pool.end();
  }
});

