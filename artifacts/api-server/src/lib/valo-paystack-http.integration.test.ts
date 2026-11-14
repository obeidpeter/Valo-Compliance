import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac,randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { db,pool,valoPaymentEvents } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import app from "../app";

test("isolated real HTTP signature/durability controls — synthetic signing key, NOT Paystack delivery",{timeout:20000},async t=>{
  assert.equal(process.env.NODE_ENV,"development");
  assert.equal(Boolean(process.env.REPLIT_DEPLOYMENT),false);
  assert.equal(Boolean(process.env.PAYSTACK_SECRET_KEY),false,"must not replace a configured merchant secret");
  assert.equal(Boolean(process.env.PAYSTACK_WEBHOOK_SECRET),false,"must not replace a configured webhook secret");
  const key="whsec_synthetic_http_regression_not_a_merchant_secret";
  process.env.PAYSTACK_WEBHOOK_SECRET=key;process.env.PAYSTACK_WEBHOOK_MODE="timestamped";
  process.env.VALO_SANDBOX_CHECKOUT_ENABLED="true";
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const transaction=`synthetic-http-${randomUUID()}`,eventKey=`test:charge.success:${transaction}`;
  const body=JSON.stringify({event:"charge.success",data:{id:transaction,reference:`unmatched-${transaction}`,customer:{notStored:"no-card-data"}}});
  function header(text=body,t=Math.floor(Date.now()/1000)){
    return `t=${t},v1=whk_http:${createHmac("sha512",key).update(t+".").update(text).digest("hex")}`;
  }
  async function post(text:string|Buffer,sig?:string,headers:Record<string,string>={}){
    return fetch(base+"/api/webhooks/paystack",{method:"POST",headers:{"Content-Type":"application/json",
      ...(sig?{"Paystack-Signature":sig}:{}),...headers},body:text});
  }
  try{
    await t.test("missing, altered, replayed, malformed and legacy-only signatures fail before persistence",async()=>{
      for(const[text,sig,extra]of[
        [body,undefined,{}],[body+" ",header(),{}],[body,header(body,Math.floor(Date.now()/1000)-301),{}],
        [body,"t=0,v1=whk_x:00",{}],[body,undefined,{"x-paystack-signature":createHmac("sha512","sk_test_control").update(body).digest("hex")}],
      ]as const)assert.equal((await post(text,sig,extra)).status,401);
      assert.equal((await db.select().from(valoPaymentEvents).where(eq(valoPaymentEvents.eventKey,eventKey))).length,0);
    });
    await t.test("correct raw bytes persist a minimal event before acknowledgement; delivery retry is duplicate",async()=>{
      const ack=z.object({received:z.literal(true),duplicate:z.boolean()});
      const first=await post(body,header());assert.equal(first.status,200);assert.equal(ack.parse(await first.json()).duplicate,false);
      const differentWhitespace=JSON.stringify(JSON.parse(body),null,2);
      const second=await post(differentWhitespace,header(differentWhitespace));
      assert.equal(second.status,200);assert.equal(ack.parse(await second.json()).duplicate,true);
      const rows=await db.select().from(valoPaymentEvents).where(eq(valoPaymentEvents.eventKey,eventKey));
      assert.equal(rows.length,1);assert.equal(rows[0].status,"pending");
      assert.equal(JSON.stringify(rows[0]).includes("no-card-data"),false);
    });
    await t.test("hostile compressed webhook input is rejected and the same server remains alive",async()=>{
      const result=await post(Buffer.concat([gzipSync(body),Buffer.from("trailing")]),header(),{"Content-Encoding":"gzip"});
      assert.equal(result.status,415);
      assert.equal((await fetch(base+"/api/healthz")).status,200);
    });
    await t.test("raw webhook route does not bypass normal private authentication",async()=>{
      assert.equal((await fetch(base+"/api/workspace/purchases")).status,401);
    });
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await db.delete(valoPaymentEvents).where(eq(valoPaymentEvents.eventKey,eventKey));
    await pool.end();
    delete process.env.PAYSTACK_WEBHOOK_SECRET;delete process.env.PAYSTACK_WEBHOOK_MODE;delete process.env.VALO_SANDBOX_CHECKOUT_ENABLED;
  }
});
