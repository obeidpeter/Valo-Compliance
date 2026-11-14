import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {fork} from "node:child_process";
import {and,eq,inArray,sql} from "drizzle-orm";
import {db,pool,valoContentVersions,valoPrices,valoOrders,valoEntitlements,valoRefundRequests,valoRefundTransitions,
  valoPurchaseOutbox,valoPaymentDisputes,valoEvents,valoMemberships,valoWorkspaces,valoStaffAssignments,
  valoStaffAccessAudit,valoDocumentRevisions,valoDocuments} from "@workspace/db";
import * as store from "./valo-store";
import {syntheticDocument} from "./valo-test-fixtures";
import {requestOrderRefund,decideRefund,processRefund,financeRefunds,refundView,type FinanceActor} from "./valo-refunds";
import {assertRefundMatch,refundBalance,type RefundProvider} from "./valo-refund-provider";
import {storeVerifiedDispute} from "./valo-payment-disputes";
import {purchases} from "./valo-commerce";
import {financeHeldFixture} from "./valo-finance-test-fixture";
import {quotaSubjectHash} from "./valo-quota";

test("refund lifecycle: actual development PostgreSQL and controlled provider, not a real refund",{timeout:90000},async t=>{
  assert.equal(process.env.NODE_ENV,"development");assert.equal(Boolean(process.env.PAYSTACK_SECRET_KEY),false);
  process.env.VALO_RUN_REFUND_TESTS="synthetic-development-only";
  const a=await store.resolveWorkspace(`synthetic-refund-${randomUUID()}`),b=await store.resolveWorkspace(`synthetic-refund-${randomUUID()}`);
  const staff:FinanceActor={identityId:`synthetic-finance-${randomUUID()}`,recentMfa:true,verifiedAt:Date.now()};
  const role=randomUUID(),supportRole=randomUUID(),priceId=randomUUID(),ids=[a.workspaceId,b.workspaceId];
  const held=await financeHeldFixture();
  await db.insert(valoPrices).values({id:priceId,contentVersionId:held.id,title:"CONTROLLED REFUND TEST — NOT RELEASED",
    amountKobo:10000,licenceVersion:"synthetic-only",licenceText:"No sales approval.",taxTreatment:"No tax assertion.",
    approvalReference:"CONTROLLED_FIXTURE_NOT_APPROVAL",effectiveFrom:new Date()});
  await db.insert(valoStaffAssignments).values({id:role,identityId:staff.identityId,role:"finance",grantedBy:"synthetic-fixture",
    reason:"Controlled isolated test role; not an actual staff grant."});
  await db.insert(valoStaffAssignments).values({id:supportRole,identityId:b.identityId,role:"support",grantedBy:"synthetic-fixture",
    reason:"Controlled support-only role must not authorize refunds."});
  const draft=await store.createDocument(a,{...syntheticDocument,title:"Private draft must survive all refund outcomes"});
  const map=new Map<string,Record<string,unknown>>();let creates=0,idCounter=Number.parseInt(randomUUID().replaceAll("-","").slice(0,12),16);
  const adapter:RefundProvider={configured:()=>true,async find(ref){return map.get(ref)??null;},
    async create(input){creates++;const data={id:String(++idCounter),reference:input.reference,domain:"test",
      amount:input.amount,currency:input.currency,transaction:input.transaction,status:"pending"};map.set(input.reference,data);return data;}};
  async function fixture(actor=a){
    const id=randomUUID();await db.insert(valoOrders).values({id,workspaceId:actor.workspaceId,requestedBy:actor.identityId,
      priceId,reference:`valo-test-${id}`,requestKey:randomUUID(),amountKobo:10000,status:"verified_success",
      providerTransactionId:String(++idCounter),line:{title:"Controlled order",contentVersionId:held.id,licenceVersion:"synthetic-only",
        licenceText:"Not approved commercial terms.",taxTreatment:"No tax assertion."}});
    await db.insert(valoEntitlements).values({id:randomUUID(),workspaceId:actor.workspaceId,orderId:id,contentVersionId:held.id});
    return id;
  }
  const payload=(amountKobo:number)=>({reason:"Controlled synthetic refund request",amountKobo,requestKey:randomUUID(),acceptedPolicyVersion:"test-refund-v1"});
  const decision=(expectedVersion=1)=>({decision:"approve",reason:"Controlled finance approval for synthetic test only",expectedVersion});
  async function row(id:string){return(await db.select().from(valoRefundRequests).where(eq(valoRefundRequests.id,id)))[0];}
  async function due(id:string){await db.update(valoRefundRequests).set({nextAttemptAt:null}).where(eq(valoRefundRequests.id,id));}
  async function approved(order:string,amount:number){
    const r=await requestOrderRefund(a,order,payload(amount));await decideRefund(staff,r.reference,decision());return r.reference;
  }
  async function blockedWrite(run:()=>Promise<unknown>,revoke:()=>Promise<unknown>,id:string){
    const lock=await pool.connect();let work:Promise<unknown>|undefined;
    try{
      await lock.query("BEGIN");await lock.query("SELECT id FROM valo_orders WHERE id=$1 FOR UPDATE",[id]);
      work=run();let observed=false;
      for(let n=0;n<80;n++){
        const r=await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%valo_orders%' LIMIT 1");
        if(r.rowCount){observed=true;break;}await new Promise(r=>setTimeout(r,10));
      }
      assert.ok(observed,"observed blocked resource write before revocation");await revoke();await lock.query("COMMIT");
      await assert.rejects(work,{status:403});
    }finally{await lock.query("ROLLBACK");lock.release();if(work)await work.catch(()=>{});}
  }
  try{
    await t.test("strict amounts, tenant isolation, idempotent retries and changed-key conflicts",async()=>{
      const order=await fixture(),p=payload(3000);
      await assert.rejects(requestOrderRefund(b,order,p),{status:404});
      for(const amountKobo of[0,-1,0.5,2147483648])await assert.rejects(requestOrderRefund(a,order,{...p,amountKobo}));
      await assert.rejects(requestOrderRefund(a,order,{...p,amountKobo:10001}),{status:409});
      const first=await requestOrderRefund(a,order,p);assert.deepEqual(await requestOrderRefund(a,order,p),first);
      await assert.rejects(requestOrderRefund(a,order,{...p,amountKobo:3001}),{status:409});
      assert.equal((await purchases(b)).orders.length,0);
    });
    await t.test("no role, wrong role, missing/stale/future MFA and stale revision cannot approve",async()=>{
      const order=await fixture(),r=await requestOrderRefund(a,order,payload(3000));
      for(const actor of[{...staff,identityId:a.identityId},{...staff,identityId:b.identityId},{...staff,recentMfa:false},
        {...staff,verifiedAt:Date.now()-300001},{...staff,verifiedAt:NaN},{...staff,verifiedAt:Date.now()+60000}]){
        await assert.rejects(decideRefund(actor,r.reference,decision()),{status:403});
      }
      await assert.rejects(decideRefund(staff,r.reference,decision(2)),{status:409});
      assert.equal((await row(r.reference)).status,"requested");
      await decideRefund(staff,r.reference,{...decision(),decision:"reject"});
      assert.equal((await row(r.reference)).status,"rejected");
      assert.equal(refundBalance(10000,[await row(r.reference)]).refundableKobo,10000);
    });
    await t.test("concurrent partial requests cannot reserve more than the paid amount",async()=>{
      const order=await fixture(),r=await Promise.allSettled([requestOrderRefund(a,order,payload(7000)),requestOrderRefund(a,order,payload(7000))]);
      assert.equal(r.filter(x=>x.status==="fulfilled").length,1);assert.equal(r.filter(x=>x.status==="rejected").length,1);
      const rows=await db.select().from(valoRefundRequests).where(eq(valoRefundRequests.orderId,order));
      assert.equal(refundBalance(10000,rows).refundableKobo,3000);
    });
    await t.test("racing approve/reject decisions record one revision and one decision reason",async()=>{
      const order=await fixture(),r=await requestOrderRefund(a,order,payload(1000));
      const outcomes=await Promise.allSettled([decideRefund(staff,r.reference,decision()),decideRefund(staff,r.reference,{...decision(),decision:"reject"})]);
      assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);assert.equal((await row(r.reference)).version,2);
      const log=await db.select().from(valoRefundTransitions).where(eq(valoRefundTransitions.refundId,r.reference));assert.equal(log.length,2);
    });
    await t.test("provider pending is not complete; partial then full processing preserves private drafts",async()=>{
      const order=await fixture(),id=await approved(order,4000);
      await processRefund(id,adapter);let r=await row(id);assert.equal(r.status,"pending");assert.equal(r.completedAt,null);
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,order)))[0].status,"active");
      map.set(r.reference,{...map.get(r.reference),status:"processed"});await due(id);await processRefund(id,adapter);
      r=await row(id);assert.equal(r.status,"processed");assert.ok(r.completedAt);
      let history=(await purchases(a)).orders.find(o=>o.id===order)!;
      assert.equal(history.refundedKobo,4000);assert.equal(history.refundableKobo,6000);
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,order)))[0].status,"active");
      const full=await approved(order,6000);await processRefund(full,adapter);const second=await row(full);
      map.set(second.reference,{...map.get(second.reference),status:"processed"});await due(full);await processRefund(full,adapter);
      history=(await purchases(a)).orders.find(o=>o.id===order)!;assert.equal(history.refundedKobo,10000);assert.equal(history.refundableKobo,0);
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,order)))[0].status,"suspended");
      assert.ok((await db.select().from(valoDocuments).where(eq(valoDocuments.id,draft.id)))[0]);
      await due(id);await processRefund(id,adapter,true);
      map.set(r.reference,{...map.get(r.reference),status:"pending"});await due(id);await processRefund(id,adapter,true);
      assert.equal((await row(id)).status,"processed");
      assert.equal((await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId,order))).length,2);
    });
    await t.test("timeout after provider acceptance reuses one reference and creates no second refund",async()=>{
      const order=await fixture(),id=await approved(order,2000);let posted=0;
      const timeout:RefundProvider={...adapter,async create(input){posted++;await adapter.create(input);throw Error("CONTROLLED_TIMEOUT_AFTER_ACCEPTANCE");}};
      await processRefund(id,timeout);assert.equal((await row(id)).status,"unknown");
      await due(id);await processRefund(id,timeout);assert.equal((await row(id)).status,"pending");assert.equal(posted,1);
    });
    await t.test("parallel workers and changed provider facts never duplicate or falsely complete",async()=>{
      const order=await fixture(),id=await approved(order,1000),before=creates;
      await Promise.all(Array.from({length:6},()=>processRefund(id,adapter)));
      assert.equal(creates-before,1);let r=await row(id);assert.equal(r.attempts,1);
      map.set(r.reference,{...map.get(r.reference),amount:1001,status:"processed"});await due(id);await processRefund(id,adapter);
      r=await row(id);assert.equal(r.status,"needs_review");assert.equal(r.completedAt,null);
      assert.equal(refundBalance(10000,[r]).refundableKobo,9000);
      const valid={id:"123",reference:r.reference,domain:"test",amount:1000,currency:"NGN",transaction:"456",status:"pending"};
      for(const change of[{currency:"USD"},{domain:"live"},{transaction:"457"},{reference:"wrong-reference"},{amount:999}]){
        assert.throws(()=>assertRefundMatch(r,"456",{...valid,...change}));
      }
    });
    await t.test("SIGKILL after committed claim recovers with the same reference and bounded attempts",async()=>{
      const order=await fixture(),id=await approved(order,1000);
      const child=fork(new URL("../scripts/refund-crash-child.ts",import.meta.url),[id],{execArgv:["--import","tsx"],
        env:{...process.env,NODE_ENV:"development"},stdio:["ignore","ignore","ignore","ipc"]});
      try{
        await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("CHILD_CLAIM_TIMEOUT")),15000);
          child.once("message",()=>{clearTimeout(timer);resolve();});child.once("error",reject);});
        child.kill("SIGKILL");await new Promise<void>(resolve=>child.once("exit",()=>resolve()));
        let r=await row(id);assert.equal(r.status,"submitting");assert.equal(r.attempts,1);
        await db.update(valoRefundRequests).set({leaseUntil:new Date(Date.now()-1000)}).where(eq(valoRefundRequests.id,id));
        await processRefund(id,adapter);r=await row(id);assert.equal(r.status,"pending");assert.equal(r.attempts,2);
        await db.update(valoRefundRequests).set({status:"unknown",attempts:5,nextAttemptAt:null}).where(eq(valoRefundRequests.id,id));
        await processRefund(id,adapter);assert.equal((await row(id)).status,"needs_review");assert.equal((await row(id)).attempts,5);
      }finally{if(child.exitCode===null)child.kill("SIGKILL");}
    });
    await t.test("committed membership and finance revocations defeat writes waiting on an order",async()=>{
      const order=await fixture();
      await blockedWrite(()=>requestOrderRefund(a,order,payload(1000)),()=>db.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.identityId,a.identityId)),order);
      await db.update(valoMemberships).set({active:"yes"}).where(eq(valoMemberships.identityId,a.identityId));
      const r=await requestOrderRefund(a,order,payload(1000));
      await blockedWrite(()=>decideRefund(staff,r.reference,decision()),()=>db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.id,role)),order);
      await db.update(valoStaffAssignments).set({active:true}).where(eq(valoStaffAssignments.id,role));
      assert.equal((await row(r.reference)).status,"requested");
    });
    await t.test("canonical disputes suspend reuse, cannot be forged across transactions, and block double compensation",async()=>{
      // A distinct tenant proves dispute history is scoped and avoids conflating
      // the preceding ten successful requests with this dispute-specific check.
      const order=await fixture(b),[o]=await db.select().from(valoOrders).where(eq(valoOrders.id,order));
      const disputeId=String(++idCounter),raw={id:disputeId,domain:"test",status:"pending",resolution:null,refund_amount:null,currency:"NGN",
        transaction:{id:o.providerTransactionId,domain:"test",reference:o.reference,amount:10000,currency:"NGN"}};
      await assert.rejects(storeVerifiedDispute(disputeId,{...raw,transaction:{...raw.transaction,amount:10001}}),{status:409});
      await storeVerifiedDispute(disputeId,raw);await assert.rejects(requestOrderRefund(b,order,payload(1000)),{status:409});
      assert.equal((await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId,order)))[0].status,"suspended");
      await storeVerifiedDispute(disputeId,{...raw,status:"resolved",resolution:"merchant-accepted",refund_amount:10000});
      await storeVerifiedDispute(disputeId,raw);
      assert.equal((await db.select().from(valoPaymentDisputes).where(eq(valoPaymentDisputes.orderId,order)))[0].status,"resolved");
      const queue=await financeRefunds(staff);assert.ok(queue.policy.includes("not approved live"));assert.ok(!JSON.stringify(queue).includes(draft.title));
      assert.equal((await purchases(a)).orders.find(o=>o.id===order),undefined);
      assert.equal((await purchases(b)).orders.find(o=>o.id===order)?.disputeStatus,"resolved");
    });
    await t.test("an explicitly exhausted refund counter blocks writes without losing saved history",async()=>{
      const order=await fixture(),before=(await purchases(a)).orders.reduce((n,o)=>n+o.refunds.length,0);
      // Do not infer the current window's usage from unrelated earlier cases.
      // This negative fixture lowers remaining allowance for THIS synthetic
      // actor only. Cover the next window too to avoid a minute-rollover flake.
      const subject=quotaSubjectHash(process.env.SESSION_SECRET,"user",a.identityId);
      await db.execute(sql`insert into valo_rate_buckets(bucket,subject_hash,window_started_at,used_count,expires_at)
        select 'refund-create',${subject},stamp,10,stamp+interval '2 minutes'
        from (select date_trunc('minute',statement_timestamp())+i*interval '1 minute' as stamp
          from generate_series(0,1) as i) as windows
        on conflict(bucket,subject_hash,window_started_at)
        do update set used_count=greatest(valo_rate_buckets.used_count,10)`);
      await assert.rejects(requestOrderRefund(a,order,payload(1)),(e:unknown)=>
        e instanceof store.ValoProblem&&e.status===429&&Boolean(e.retryAfter));
      assert.equal((await purchases(a)).orders.reduce((n,o)=>n+o.refunds.length,0),before);
    });
    await t.test("legacy unknown amounts cannot be authorized; rejection is explicit and auditable",async()=>{
      const order=await fixture(),id=randomUUID();
      await db.insert(valoRefundRequests).values({id,workspaceId:a.workspaceId,orderId:order,reference:`vr-test-${id}`,reason:"Legacy unknown-amount controlled fixture"});
      assert.equal(refundBalance(10000,[await row(id)]).refundableKobo,0);
      await assert.rejects(decideRefund(staff,id,decision()),{status:409});
      await decideRefund(staff,id,{...decision(),decision:"reject"});
      assert.equal((await row(id)).status,"rejected");
    });
    await t.test("a verified failed provider refund releases funds; needs-attention does not invent completion",async()=>{
      const order=await fixture(),id=randomUUID();
      // Explicit synthetic fixture avoids changing or resetting the real quota.
      await db.insert(valoRefundRequests).values({id,workspaceId:a.workspaceId,orderId:order,reference:`vr-test-${id}`,
        reason:"Controlled provider lifecycle fixture",amountKobo:1000,policyVersion:"test-refund-v1"});
      await decideRefund(staff,id,decision());await processRefund(id,adapter);let r=await row(id);
      map.set(r.reference,{...map.get(r.reference),status:"needs-attention"});await due(id);await processRefund(id,adapter);
      r=await row(id);assert.equal(r.status,"needs_attention");assert.equal(r.completedAt,null);
      map.set(r.reference,{...map.get(r.reference),status:"failed"});await due(id);await processRefund(id,adapter);
      r=await row(id);assert.equal(r.status,"failed");assert.equal(refundBalance(10000,[r]).refundableKobo,10000);
    });
    await t.test("a late worker response cannot replace a newer completed observation",async()=>{
      const order=await fixture(),id=randomUUID();
      await db.insert(valoRefundRequests).values({id,workspaceId:a.workspaceId,orderId:order,reference:`vr-test-${id}`,
        reason:"Controlled fenced-response fixture",amountKobo:1000,policyVersion:"test-refund-v1"});
      await decideRefund(staff,id,decision());
      const saved=await row(id),[o]=await db.select().from(valoOrders).where(eq(valoOrders.id,order));
      const observed={id:String(++idCounter),reference:saved.reference,domain:"test",amount:1000,currency:"NGN",
        transaction:o.providerTransactionId,status:"processed"};
      let release!:()=>void,started!:()=>void,first=true;
      const waiting=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r);
      const slow:RefundProvider={...adapter,async find(){if(first){first=false;started();await waiting;return{...observed,status:"pending"};}return observed;}};
      const old=processRefund(id,slow);await ready;
      await db.update(valoRefundRequests).set({leaseUntil:new Date(Date.now()-1000)}).where(eq(valoRefundRequests.id,id));
      await processRefund(id,slow);release();await old;
      assert.equal((await row(id)).status,"processed");
      assert.equal((await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId,order))).length,1);
    });
    await t.test("reversed payment or a late processed refund blocks a newly unsafe dispatch",async()=>{
      const reserve=async(order:string,amountKobo:number)=>{
        const id=randomUUID();await db.insert(valoRefundRequests).values({id,workspaceId:a.workspaceId,orderId:order,
          reference:`vr-test-${id}`,reason:"Controlled late-financial-state fixture",amountKobo,policyVersion:"test-refund-v1"});
        await decideRefund(staff,id,decision());return id;
      };
      const reversed=await fixture(),held=await reserve(reversed,1000),start=creates;
      await db.update(valoOrders).set({status:"reversed"}).where(eq(valoOrders.id,reversed));
      await processRefund(held,adapter);assert.equal((await row(held)).failure,"PAYMENT_STATE_CHANGED");assert.equal(creates,start);
      const order=await fixture(),old=await reserve(order,4000);await processRefund(old,adapter);
      const original=await row(old);
      map.set(original.reference,{...map.get(original.reference),status:"failed"});await due(old);await processRefund(old,adapter);
      const replacement=await reserve(order,10000);
      map.set(original.reference,{...map.get(original.reference),status:"processed"});await due(old);await processRefund(old,adapter,true);
      assert.equal((await row(old)).status,"processed");const before=creates;
      await processRefund(replacement,adapter);assert.equal((await row(replacement)).failure,"REFUND_BALANCE_CHANGED");
      assert.equal(creates,before);
    });
    await t.test("the database rejects changes to financial transition history",async()=>{
      const[r]=await db.select().from(valoRefundTransitions).where(inArray(valoRefundTransitions.workspaceId,ids)).limit(1);
      assert.ok(r);await assert.rejects(db.update(valoRefundTransitions).set({reason:"tampered"}).where(eq(valoRefundTransitions.id,r.id)));
      await assert.rejects(db.delete(valoRefundTransitions).where(eq(valoRefundTransitions.id,r.id)));
      const[unchanged]=await db.select().from(valoRefundTransitions).where(eq(valoRefundTransitions.id,r.id));
      assert.equal(unchanged.reason,r.reason);
    });
    console.log(JSON.stringify({realPaystackCalls:0,controlledProviderOnly:true,realKernelSigkill:true,leaseClockAdvance:"owned synthetic row",
      livePayments:false,publicationsCreated:0,privateDraftPreserved:true,syntheticFinancialParentsRetainedForAudit:true}));
  }finally{
    // Never disable immutable finance evidence for teardown. Retain financial
    // rows plus their explicitly synthetic order/price/workspace FK parents.
    for(const table of[valoDocumentRevisions,valoDocuments])await db.delete(table).where(inArray(table.workspaceId,ids));
    await db.update(valoStaffAssignments).set({active:false}).where(inArray(valoStaffAssignments.id,[role,supportRole]));
    await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId,ids));
    await pool.end();
  }
});
