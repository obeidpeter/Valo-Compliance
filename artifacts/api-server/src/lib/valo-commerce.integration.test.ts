import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and,eq,inArray,sql } from "drizzle-orm";
import { db,pool,valoContentVersions,valoPublicationPolicies,valoPrices,valoOrders,valoEntitlements,
  valoPurchaseOutbox,valoRefundRequests,valoRefundTransitions,valoPaymentEvents,valoEvents,valoMemberships,valoWorkspaces,valoPaymentReconciliations } from "@workspace/db";
import * as store from "./valo-store";
import * as commerce from "./valo-commerce";
import { verifiedTransaction } from "./valo-paystack-contract";
import {financeHeldFixture} from "./valo-finance-test-fixture";

test("controlled PostgreSQL commerce mechanics — NOT real Paystack execution or publication",{timeout:40000},async t=>{
  assert.equal(process.env.NODE_ENV,"development");
  const a=await store.resolveWorkspace(`synthetic-commerce-${randomUUID()}`),b=await store.resolveWorkspace(`synthetic-commerce-${randomUUID()}`);
  // Reuse an actual held development version; never insert or forge a release.
  const held=await financeHeldFixture();
  assert.ok(held,"An actual held development candidate is required for this non-publication mechanics proof.");
  const version=held.id,priceId=randomUUID(),workspaces=[a.workspaceId,b.workspaceId];
  const fixtureLine={title:"CONTROLLED TEST ONLY — not a released product",contentVersionId:version,
    licenceVersion:"controlled-not-approved",licenceText:"CONTROLLED TEST ONLY. Not commercial terms approval.",taxTreatment:"Test amount only; no tax assertion."};
  const orders:string[]=[],eventKeys:string[]=[];
  async function fixture(actor=a,line=fixtureLine){
    const id=randomUUID();orders.push(id);
    const[row]=await db.insert(valoOrders).values({id,workspaceId:actor.workspaceId,requestedBy:actor.identityId,requestKey:randomUUID(),
      priceId,reference:`valo-test-${id}`,amountKobo:12345,line}).returning();
    return row;
  }
  function response(o:Awaited<ReturnType<typeof fixture>>,patch:Record<string,unknown>={}){
    return verifiedTransaction.parse({id:String(Math.floor(Math.random()*1e12)),domain:"test",reference:o.reference,status:"success",
      amount:o.amountKobo,currency:"NGN",metadata:{valoOrderId:o.id,workspaceId:o.workspaceId},...patch});
  }
  try{
    await db.insert(valoPrices).values({id:priceId,contentVersionId:version,title:fixtureLine.title,amountKobo:12345,
      licenceVersion:fixtureLine.licenceVersion,licenceText:fixtureLine.licenceText,taxTreatment:fixtureLine.taxTreatment,
      approvalReference:"CONTROLLED_FIXTURE_NOT_APPROVAL",effectiveFrom:new Date(Date.now()-1000)});
    await t.test("held content and browser price/currency additions cannot create an order",async()=>{
      await assert.rejects(commerce.createOrder(a,{priceId,requestKey:randomUUID(),acceptedLicenceVersion:fixtureLine.licenceVersion}),{status:409});
      await assert.rejects(commerce.createOrder(a,{priceId,requestKey:randomUUID(),acceptedLicenceVersion:fixtureLine.licenceVersion,
        amountKobo:1,currency:"USD"}));
      assert.equal((await commerce.purchases(a)).orders.length,0);
      assert.equal((await commerce.commerceProducts()).some(p=>p.id===priceId),false);
    });
    const order=await fixture(),verified=response(order);
    await t.test("saved controlled order is not a receipt or entitlement; no browser-success grant exists",async()=>{
      assert.equal((await commerce.purchases(a)).orders[0].status,"created");
      await assert.rejects(commerce.purchaseReceipt(a,order.id),{status:409});
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,order.id))).length,0);
    });
    await t.test("other tenants cannot read a receipt, refresh, checkout, settle or request a refund",async()=>{
      for(const call of[()=>commerce.purchaseReceipt(b,order.id),()=>commerce.refreshOrder(b,order.id),
        ()=>commerce.startCheckout(b,order.id,"synthetic@example.test"),()=>commerce.requestRefund(b,order.id,{reason:"Controlled test request",
          amountKobo:1000,requestKey:randomUUID(),acceptedPolicyVersion:"test-refund-v1"}),
        ()=>commerce.settleVerifiedOrder(order.id,verified,b)])await assert.rejects(call(),{status:404});
      assert.equal((await commerce.purchases(b)).orders.length,0);
    });
    await t.test("mismatched amount and workspace never grant; data outside test mode is rejected",async()=>{
      await assert.rejects(commerce.settleVerifiedOrder(order.id,{...verified,amount:12346}),{status:409});
      await assert.rejects(commerce.settleVerifiedOrder(order.id,{...verified,metadata:{...verified.metadata,workspaceId:b.workspaceId}}),{status:409});
      await assert.rejects(commerce.settleVerifiedOrder(order.id,{...verified,domain:"live"} as never));
    });
    await t.test("concurrent controlled callback/webhook results grant one entitlement, one receipt outbox and one settlement event",async()=>{
      const result=await Promise.all(Array.from({length:8},()=>commerce.settleVerifiedOrder(order.id,verified)));
      assert.ok(result.every(r=>r.status==="verified_success"));
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,order.id))).length,1);
      const outbox=await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId,order.id));
      assert.equal(outbox.length,1);assert.equal(outbox[0].status,"awaiting_email_configuration");
      const audit=await db.select().from(valoEvents).where(and(eq(valoEvents.entityId,order.id),eq(valoEvents.action,"payment.verified_success")));
      assert.equal(audit.length,1);
    });
    await t.test("receipt/licence history is private and independent of a later price edit",async()=>{
      await db.update(valoPrices).set({amountKobo:99999,licenceText:"A later test price"}).where(eq(valoPrices.id,priceId));
      const receipt=await commerce.purchaseReceipt(a,order.id);
      assert.equal(receipt.amountKobo,12345);assert.equal(receipt.licenceText,fixtureLine.licenceText);
      assert.match(receipt.notice,/test-mode/);assert.equal(receipt.deliveryStatus,"awaiting_email_configuration");
      assert.equal(receipt.receiptReference,`VALO-TEST-${order.reference}`);
    });
    await t.test("duplicate refund requests persist once without completing a refund or deleting owned work",async()=>{
      const payload={reason:"Controlled test of refund request persistence",amountKobo:12345,requestKey:randomUUID(),acceptedPolicyVersion:"test-refund-v1"};
      const r=await commerce.requestRefund(a,order.id,payload);
      const again=await commerce.requestRefund(a,order.id,payload);
      assert.deepEqual(r,again);assert.equal(r.status,"requested");
      const[grant]=await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,order.id));
      assert.equal(grant.status,"active");
    });
    await t.test("a failed fulfilment constraint rolls back settlement and outbox atomically",async()=>{
      const broken=await fixture(a,{...fixtureLine,contentVersionId:randomUUID()});
      await assert.rejects(commerce.settleVerifiedOrder(broken.id,response(broken)));
      const[saved]=await db.select().from(valoOrders).where(eq(valoOrders.id,broken.id));
      assert.equal(saved.status,"created");
      assert.equal((await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId,broken.id))).length,0);
    });
    await t.test("pending, abandoned and failed provider controls do not grant; a late success can recover",async()=>{
      for(const status of["pending","abandoned","failed"]as const){
        const o=await fixture(),data=response(o,{status});
        const result=await commerce.settleVerifiedOrder(o.id,data);
        assert.equal(result.status,status);
        assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,o.id))).length,0);
        assert.equal((await commerce.settleVerifiedOrder(o.id,{...data,status:"success"})).status,"verified_success");
      }
    });
    await t.test("reversal suspends reuse without deleting financial or customer history",async()=>{
      await commerce.settleVerifiedOrder(order.id,{...verified,status:"reversed"});
      const[grant]=await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,order.id));
      assert.equal(grant.status,"suspended");assert.equal((await commerce.purchases(a)).orders.find(o=>o.id===order.id)!.status,"reversed");
      await assert.rejects(commerce.startCheckout(a,order.id,"synthetic@example.test"),{status:409});
    });
    await t.test("membership revoked while settlement waits on an order lock prevents the eventual customer write",async()=>{
      const waiting=await fixture(),data=response(waiting),connection=await pool.connect();
      try{
        await connection.query("BEGIN");await connection.query("SELECT id FROM valo_orders WHERE id=$1 FOR UPDATE",[waiting.id]);
        const write=commerce.settleVerifiedOrder(waiting.id,data,a);
        let observed=false;
        for(let n=0;n<60;n++){
          const r=await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%valo_orders%' LIMIT 1");
          if(r.rowCount){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(observed,true,"observed actual blocked resource lock before revocation");
        await db.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.identityId,a.identityId));
        await connection.query("COMMIT");
        await assert.rejects(write,{status:403});
        assert.equal((await db.select().from(valoOrders).where(eq(valoOrders.id,waiting.id)))[0].status,"created");
      }finally{await connection.query("ROLLBACK");connection.release();
        await db.update(valoMemberships).set({active:"yes"}).where(eq(valoMemberships.identityId,a.identityId));}
    });
    await t.test("durable event deduplication ignores whitespace and delivery retries without retaining card data",async()=>{
      const event={event:"charge.success",data:{id:order.reference,reference:order.reference,authorization:{card:"NOT_RETAINED"}}};
      eventKeys.push(`test:charge.success:${order.reference}`);
      const first=await commerce.recordPaymentEvent(Buffer.from(JSON.stringify(event)));
      const second=await commerce.recordPaymentEvent(Buffer.from(JSON.stringify(event,null,2)));
      assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);
      const[row]=await db.select().from(valoPaymentEvents).where(eq(valoPaymentEvents.eventKey,eventKeys[0]));
      assert.equal(row.status,"pending");assert.equal(JSON.stringify(row).includes("NOT_RETAINED"),false);
    });
    await t.test("no merchant setup means no provider calls, false match, consumed event attempt or claimed delivery",async()=>{
      assert.equal(Boolean(process.env.PAYSTACK_SECRET_KEY),false,"this proof is explicitly credential-free");
      await commerce.processPaymentEvents();await commerce.reconcilePayments();
      const[row]=await db.select().from(valoPaymentEvents).where(eq(valoPaymentEvents.eventKey,eventKeys[0]));
      assert.equal(row.attempts,0);assert.equal(row.status,"pending");
      const o=await fixture();
      await assert.rejects(commerce.refreshOrder(a,o.id),{status:503});
      await assert.rejects(commerce.purchaseReceipt(a,o.id),{status:409});
    });
    console.log(JSON.stringify({scope:"Controlled database payment mechanics, not Paystack execution",realProviderCalls:0,
      publishedFixtures:0,priceApproval:false,livePayments:false}));
  }finally{
    await db.delete(valoPaymentEvents).where(inArray(valoPaymentEvents.eventKey,eventKeys.length?eventKeys:["none"]));
    // Retain immutable synthetic financial history and FK parents. No trigger
    // is disabled to make cleanup or a test pass.
    await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId,workspaces));
    await pool.end();
  }
});
