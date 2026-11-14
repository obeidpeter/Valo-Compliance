import {test} from "node:test";
import assert from "node:assert/strict";
import {refundProvider,providerRefund,refundBalance} from "./valo-refund-provider";
test("native Paystack refund adapter: controlled transport only, no payment credentials",{concurrency:false},async t=>{
  const originalFetch=globalThis.fetch;
  const names=["NODE_ENV","REPLIT_DEPLOYMENT","VALO_SANDBOX_CHECKOUT_ENABLED","VALO_SANDBOX_REFUNDS_ENABLED","PAYSTACK_SECRET_KEY"]as const;
  const before=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  process.env.NODE_ENV="development";delete process.env.REPLIT_DEPLOYMENT;
  process.env.VALO_SANDBOX_CHECKOUT_ENABLED="true";process.env.VALO_SANDBOX_REFUNDS_ENABLED="true";
  process.env.PAYSTACK_SECRET_KEY="sk_test_controlled_fake_refund_key";
  const input={reference:"vr-test-controlled-reference-1",transaction:"12345",amount:1200,currency:"NGN"as const};
  const record={id:99,...input,domain:"test",status:"pending"};
  try{
    await t.test("reference conflict looks up existing refund instead of generating another reference",async()=>{
      const calls:string[]=[];
      globalThis.fetch=async(url,options)=>{
        calls.push(String(url));assert.equal(options?.redirect,"error");assert.ok(options?.signal);
        if(options?.method==="POST"){
          assert.deepEqual(JSON.parse(String(options.body)),input);
          return new Response(JSON.stringify({status:false}),{status:409});
        }
        assert.equal(String(url),"https://api.paystack.co/refund?reference="+input.reference);
        return Response.json({status:true,data:[record]});
      };
      assert.equal(providerRefund.parse(await refundProvider.create(input)).id,"99");
      assert.equal(calls.length,2);
    });
    await t.test("timeout after acceptance recovers by the same reference and is not labelled failed",async()=>{
      let posts=0,accepted=false;
      globalThis.fetch=async(_url,options)=>{
        if(options?.method==="POST"){posts++;accepted=true;throw Error("CONTROLLED_POST_ACCEPTANCE_TIMEOUT");}
        return Response.json({status:true,data:accepted?[record]:[]});
      };
      const found=providerRefund.parse(await refundProvider.create(input));
      assert.equal(found.reference,input.reference);assert.equal(found.status,"pending");assert.equal(posts,1);
    });
    await t.test("missing or ambiguous lookup never manufactures an observation",async()=>{
      globalThis.fetch=async()=>Response.json({status:true,data:[]});
      assert.equal(await refundProvider.find(input.reference),null);
      globalThis.fetch=async()=>Response.json({status:true,data:[record,record]});
      await assert.rejects(refundProvider.find(input.reference),{status:409});
    });
    await t.test("test-only configuration, independent limits and unknown amounts fail closed",()=>{
      assert.equal(refundProvider.configured(),true);
      process.env.PAYSTACK_SECRET_KEY="sk_live_CONTROLLED_FAKE_NOT_REAL";
      assert.equal(refundProvider.configured(),false);
      process.env.PAYSTACK_SECRET_KEY="sk_test_controlled_fake_refund_key";
      process.env.REPLIT_DEPLOYMENT="1";assert.equal(refundProvider.configured(),false);
      assert.deepEqual(refundBalance(10000,[{amountKobo:null,status:"requested"}]),{refundableKobo:0,refundedKobo:0});
      assert.deepEqual(refundBalance(10000,[{amountKobo:3000,status:"processed"},{amountKobo:7000,status:"failed"}]),
        {refundableKobo:7000,refundedKobo:3000});
    });
  }finally{
    globalThis.fetch=originalFetch;
    for(const name of names){if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];}
  }
});
