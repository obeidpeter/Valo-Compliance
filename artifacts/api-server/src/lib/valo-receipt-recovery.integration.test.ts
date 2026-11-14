import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {and,eq} from "drizzle-orm";
import {db,pool,valoPrices,valoOrders,valoEntitlements,valoPurchaseOutbox,valoEvents} from "@workspace/db";
import {financeHeldFixture} from "./valo-finance-test-fixture";
import {resolveWorkspace} from "./valo-store";
import {recoverSyntheticPurchaseReceipt,purchaseReceipt} from "./valo-commerce";

test("recorded synthetic receipt recovery, no provider verification or messages",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",
},async t=>{
  const prior=process.env.VALO_SYNTHETIC_RECEIPT_RECOVERY;
  const actor=await resolveWorkspace(`synthetic-refund-receipt-${randomUUID()}`);
  const foreign=await resolveWorkspace(`synthetic-other-receipt-${randomUUID()}`);
  const version=await financeHeldFixture(),priceId=randomUUID(),orderId=randomUUID();
  const line={title:"Controlled order",contentVersionId:version.id,licenceVersion:"synthetic-only",
    licenceText:"Synthetic test only. No approved sale.",taxTreatment:"No tax assertion."};
  try{
    await db.insert(valoPrices).values({id:priceId,title:line.title,contentVersionId:version.id,amountKobo:10000,
      licenceVersion:"synthetic-only",licenceText:line.licenceText,taxTreatment:line.taxTreatment,
      approvalReference:"CONTROLLED FIXTURE NOT COMMERCIAL APPROVAL",effectiveFrom:new Date()});
    await db.insert(valoOrders).values({id:orderId,workspaceId:actor.workspaceId,requestedBy:actor.identityId,
      requestKey:randomUUID(),priceId,reference:`valo-test-${orderId}`,amountKobo:10000,
      line,status:"verified_success",providerTransactionId:`controlled-receipt-${orderId}`});
    await t.test("missing maintenance opt-in and missing recorded grant both fail closed",async()=>{
      delete process.env.VALO_SYNTHETIC_RECEIPT_RECOVERY;
      await assert.rejects(()=>recoverSyntheticPurchaseReceipt(orderId),{status:403});
      process.env.VALO_SYNTHETIC_RECEIPT_RECOVERY="owned-recorded-fixtures-only";
      await assert.rejects(()=>recoverSyntheticPurchaseReceipt(orderId),{status:409});
      assert.equal((await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId,orderId))).length,0);
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,orderId))).length,0);
    });
    await db.insert(valoEntitlements).values({id:randomUUID(),workspaceId:actor.workspaceId,orderId,
      contentVersionId:version.id,status:"suspended"});
    const before=(await db.select().from(valoOrders).where(eq(valoOrders.id,orderId)))[0];
    await t.test("concurrent repair produces one held receipt and one audit without reactivating the grant",async()=>{
      await db.insert(valoPurchaseOutbox).values({id:randomUUID(),workspaceId:actor.workspaceId,orderId,
        kind:"refund_status",status:"held_controlled_fixture"});
      const results=await Promise.all(Array.from({length:8},()=>recoverSyntheticPurchaseReceipt(orderId)));
      const messages=await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId,orderId));
      assert.equal(messages.filter(x=>x.kind==="purchase_receipt").length,1);
      assert.equal(messages.find(x=>x.kind==="refund_status")?.status,"held_controlled_fixture");
      assert.equal(results.filter(r=>r.repaired).length,1);
      assert.equal(new Set(results.map(r=>r.receiptId)).size,1);
      assert.ok(results.every(r=>r.deliveryStatus==="held_synthetic_recovery"));
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,orderId)))[0].status,"suspended");
      assert.deepEqual((await db.select().from(valoOrders).where(eq(valoOrders.id,orderId)))[0],before);
      assert.equal((await db.select().from(valoEvents).where(and(eq(valoEvents.entityId,orderId),
        eq(valoEvents.action,"payment.synthetic_receipt_recovered")))).length,1);
    });
    await t.test("retries preserve the original receipt; other tenants cannot read it",async()=>{
      assert.equal((await recoverSyntheticPurchaseReceipt(orderId)).repaired,false);
      await assert.rejects(()=>purchaseReceipt(foreign,orderId),{status:404});
      const receipt=await purchaseReceipt(actor,orderId);
      assert.equal(receipt.amountKobo,10000);
      assert.equal(receipt.licenceVersion,"synthetic-only");
      await db.update(valoOrders).set({status:"reversed"}).where(eq(valoOrders.id,orderId));
      const reversed=await purchaseReceipt(actor,orderId);
      assert.equal(reversed.amountKobo,10000);assert.equal(reversed.status,"reversed");
      await assert.rejects(()=>recoverSyntheticPurchaseReceipt(orderId),{status:409});
    });
  }finally{
    // Retain explicitly synthetic financial history and its immutable parents.
    if(prior===undefined)delete process.env.VALO_SYNTHETIC_RECEIPT_RECOVERY;
    else process.env.VALO_SYNTHETIC_RECEIPT_RECOVERY=prior;
    await pool.end();
  }
});
