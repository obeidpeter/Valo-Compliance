import {test} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomUUID} from "node:crypto";
import {eq,inArray} from "drizzle-orm";
import {db,pool,valoStaffAssignments,valoPrivacyCases,valoPrivacyEvents,valoPrivacyTombstones,
  valoPrivacyErasureObjects,valoStaffAccessAudit,valoWorkspaces,valoMemberships,
  valoSupportTickets,valoEvents} from "@workspace/db";
import {createPrivacyOperationsRouter,makeVerifiedStaffSession} from "./valo-customer-access";
import {createPrivacyCase,confirmPrivacyCase} from "../lib/valo-privacy";
import {resolveWorkspace,ValoProblem} from "../lib/valo-store";

test("actual HTTP privacy routes apply an independent privacy role and fresh MFA",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",timeout:30000,
},async t=>{
  assert.equal(process.env.NODE_ENV,"development");assert.ok(!process.env.REPLIT_DEPLOYMENT);
  const tag=randomUUID(),owner=await resolveWorkspace(`synthetic-http-privacy-${tag}`);
  const roles=["privacy","finance","revoked","stale"].map(x=>`synthetic-http-${x}-${tag}`);
  let sessionRevoked=false,emailVerified=true,sessionMismatch=false;
  const app=express();
  app.use(express.json());
  app.use("/admin/privacy-cases",createPrivacyOperationsRouter(makeVerifiedStaffSession({
    auth:req=>{
      const raw=req.header("x-test-identity"),id=raw&&roles.includes(raw)?raw:null;
      return{userId:id,sessionId:id?`controlled-session:${id}`:null,has:()=>Boolean(id&&!id.includes("stale"))};
    },
    session:async id=>({status:sessionRevoked?"revoked":"active",userId:sessionMismatch?"different-user":id.slice("controlled-session:".length)}),
    user:async id=>({id,banned:false,locked:false,primaryEmailAddressId:"controlled-primary",
      emailAddresses:[{id:"controlled-primary",verification:{status:emailVerified?"verified":"unverified"}}]}),
  })));
  app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    res.status(err instanceof ValoProblem?err.status:503).json({error:err instanceof Error?err.message:"unavailable"});
  });
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",()=>resolve()));
  const address=server.address();
  if(!address||typeof address==="string")throw Error("HTTP_LISTENER_UNAVAILABLE");
  const base=`http://127.0.0.1:${address.port}`;
  const previousOrigin=process.env.VALO_TRUSTED_ORIGIN;
  process.env.VALO_TRUSTED_ORIGIN=base;
  let caseId="";
  try{
    for(const [index,role]of(["privacy","finance","privacy","privacy"] as const).entries()){
      await db.insert(valoStaffAssignments).values({id:randomUUID(),identityId:roles[index],role,
        active:index!==2,grantedBy:"controlled-fixture",reason:"HTTP role-separation regression"});
    }
    const created=await createPrivacyCase(owner,"synthetic@example.invalid",{
      kind:"deletion",idempotencyKey:randomUUID(),message:"Controlled HTTP privacy request.",
      acknowledgement:true});
    caseId=created.reference.slice(5);
    const verified=await confirmPrivacyCase(owner,caseId,{expectedVersion:1,acknowledgement:true});
    const request=(identity?:string,method="GET",body?:object,origin=base)=>
      fetch(`${base}/admin/privacy-cases${method==="POST"?`/${caseId}/action`:""}`,{
        method,headers:{"Content-Type":"application/json","Origin":origin,
          ...(identity?{"x-test-identity":identity}:{})},...(body?{body:JSON.stringify(body)}:{})});
    await t.test("privacy-only identity can read and claim; finance-only cannot",async()=>{
      assert.equal((await request()).status,401);
      assert.equal((await request(roles[1])).status,403);
      assert.equal((await request(roles[0])).status,200);
      const res=await request(roles[0],"POST",{action:"claim",expectedVersion:verified.request.version,
        reason:"Assigned to a controlled privacy-only operator."});
      assert.equal(res.status,200);
      const detail=await res.json() as {request:{status:string;version:number}};
      assert.equal(detail.request.status,"assigned");
      assert.equal((await request(roles[1],"POST",{action:"hold",expectedVersion:detail.request.version,
        reason:"Finance must not control privacy requests."})).status,403);
    });
    await t.test("revoked and stale-MFA privacy identities fail on the HTTP route",async()=>{
      assert.equal((await request(roles[2])).status,403);
      assert.equal((await request(roles[3])).status,403);
      sessionRevoked=true;assert.equal((await request(roles[0])).status,403);sessionRevoked=false;
      emailVerified=false;assert.equal((await request(roles[0])).status,403);emailVerified=true;
      sessionMismatch=true;assert.equal((await request(roles[0])).status,403);sessionMismatch=false;
      await db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.identityId,roles[0]));
      assert.equal((await request(roles[0])).status,403);
    });
    await t.test("hostile origin never reaches the privacy mutation",async()=>{
      const r=await request(roles[0],"POST",{action:"hold",expectedVersion:2,
        reason:"Hostile origin cannot submit."},"https://hostile.synthetic.invalid");
      assert.equal(r.status,403);
    });
  }finally{
    if(previousOrigin===undefined)delete process.env.VALO_TRUSTED_ORIGIN;else process.env.VALO_TRUSTED_ORIGIN=previousOrigin;
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    for(const table of[valoPrivacyErasureObjects,valoPrivacyEvents,valoPrivacyTombstones,valoPrivacyCases,
      valoSupportTickets,valoEvents,valoMemberships])
      await db.delete(table).where(eq(table.workspaceId,owner.workspaceId));
    await db.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId,roles));
    await db.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId,roles));
    await db.delete(valoWorkspaces).where(eq(valoWorkspaces.id,owner.workspaceId));
    await pool.end();
  }
});
