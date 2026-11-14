import test from "node:test";
import assert from "node:assert/strict";
import {paystackRequest} from "./valo-paystack-contract";
import {refundProvider} from "./valo-refund-provider";
import {assertRecoveryEffectsAllowed} from "./valo-recovery-effects";
test("recovery blocks actual charge/refund provider boundaries before transport or credential lookup",async()=>{
  const originalFetch=globalThis.fetch,old=process.env.VALO_ISOLATED_RECOVERY;
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error("TRANSPORT_MUST_NOT_RUN");};
  try{
    for(const value of ["synthetic-local-only","1","true","arbitrary"," "]){
      process.env.VALO_ISOLATED_RECOVERY=value;
      assert.throws(()=>assertRecoveryEffectsAllowed(),/RECOVERY_EXTERNAL_EFFECTS_DISABLED/);
      await assert.rejects(()=>paystackRequest("/transaction/initialize",{}),/RECOVERY_EXTERNAL_EFFECTS_DISABLED/);
      await assert.rejects(()=>refundProvider.create({reference:"synthetic-reference",transaction:"123",amount:100,currency:"NGN"}),/RECOVERY_EXTERNAL_EFFECTS_DISABLED/);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=originalFetch;if(old===undefined)delete process.env.VALO_ISOLATED_RECOVERY;else process.env.VALO_ISOLATED_RECOVERY=old;}
});
