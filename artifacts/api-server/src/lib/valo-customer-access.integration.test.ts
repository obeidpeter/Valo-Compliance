import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq,inArray,and } from "drizzle-orm";
import { db,pool,valoAccessSupport,valoStaffAssignments,valoStaffAccessAudit,valoMemberships,
  valoDocuments,valoDocumentRevisions,valoSupportTickets,valoEvents,valoWorkspaces,
  valoPrivacyCases,valoPrivacyEvents,valoPrivacyTombstones } from "@workspace/db";
import {customerPrivacyDetail} from "./valo-privacy";
import { saveAccessSupport,customerAccount,requestPrivacy,workspaceDataExport,staffOperations } from "./valo-customer-access";
import { resolveWorkspace,createDocument,ValoProblem } from "./valo-store";
import { syntheticDocument } from "./valo-test-fixtures";
test("real development access intake, privacy isolation and staff boundaries",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",
},async t=>{
  assert.equal(process.env.NODE_ENV,"development");assert.ok(!process.env.REPLIT_DEPLOYMENT);
  const run=randomUUID(),email=`access-${run}@example.invalid`,socket=`synthetic-${run}`;
  const input={idempotencyKey:randomUUID(),email,topic:"account_access" as const,message:"Synthetic account access problem. No confidential details."};
  const a=await resolveWorkspace(`synthetic-access-a-${run}`),b=await resolveWorkspace(`synthetic-access-b-${run}`);
  const staff=`synthetic-staff-${run}`,role=randomUUID();
  const ids=[a.workspaceId,b.workspaceId];
  try{
    await t.test("no login or account lookup is needed; confirmation is saved, never dispatched",async()=>{
      const r=await saveAccessSupport(input,socket);
      assert.equal(r.delivery,"not_dispatched");assert.match(r.message,/No account details/);
      const[stored]=await db.select().from(valoAccessSupport).where(eq(valoAccessSupport.idempotencyKey,input.idempotencyKey));
      assert.equal(stored.status,"awaiting_staff");assert.equal(stored.contactEmail,email);
    });
    await t.test("idempotent retry preserves one record; altered reuse fails",async()=>{
      assert.deepEqual(await saveAccessSupport(input,socket),await saveAccessSupport(input,socket));
      assert.equal((await db.select().from(valoAccessSupport).where(eq(valoAccessSupport.idempotencyKey,input.idempotencyKey))).length,1);
      await assert.rejects(()=>saveAccessSupport({...input,message:"A different synthetic request using the same identifier."},socket),
        (e:unknown)=>e instanceof ValoProblem&&e.status===409);
    });
    await t.test("honeypot and invalid email fail without saving",async()=>{
      await assert.rejects(()=>saveAccessSupport({...input,idempotencyKey:randomUUID(),website:"bot"},socket));
      await assert.rejects(()=>saveAccessSupport({...input,idempotencyKey:randomUUID(),email:"not-an-email"},socket));
    });
    await t.test("concurrent verified-or-unverified contacts cannot create unlimited anonymous tickets",async()=>{
      const same=`burst-${run}@example.invalid`;
      const results=await Promise.allSettled(Array.from({length:15},()=>saveAccessSupport({...input,email:same,idempotencyKey:randomUUID()},socket)));
      assert.equal(results.filter(r=>r.status==="fulfilled").length,3);
      for(const r of results)if(r.status==="rejected"){
        assert.ok(r.reason instanceof ValoProblem);assert.equal(r.reason.status,429);assert.ok((r.reason.retryAfter??0)>0);
      }
      assert.equal((await db.select().from(valoAccessSupport).where(eq(valoAccessSupport.contactEmail,same))).length,3);
    });
    await t.test("different contacts receive the same non-enumerating wording",async()=>{
      const other=await saveAccessSupport({...input,email:`other-${run}@example.invalid`,idempotencyKey:randomUUID()},socket);
      const original=await saveAccessSupport(input,socket);assert.equal(other.message,original.message);
      assert.equal(other.delivery,original.delivery);assert.equal(other.reference.length,original.reference.length);
    });
    await t.test("privacy requests really persist and do not claim deletion",async()=>{
      const r=await requestPrivacy(a,email,{kind:"deletion",message:"Synthetic request to remove this test workspace later.",acknowledgement:true});
      assert.match(r.message,/no export, correction, deletion or provider action has been completed/i);
      assert.equal((await customerAccount(a)).privacyRequests.length,1);
      assert.equal((await customerAccount(b)).privacyRequests.length,0);
      const request=await customerPrivacyDetail(a,r.reference.slice(5));
      assert.equal(request.request.status,"awaiting_verification");
      assert.equal(request.request.resultAvailable,false);assert.equal(request.events.length,1);
      await assert.rejects(()=>customerPrivacyDetail(b,r.reference.slice(5)),{status:404});
    });
    await t.test("workspace JSON export includes saved revisions but excludes another business",async()=>{
      const doc=await createDocument(a,syntheticDocument);
      const own=await workspaceDataExport(a),other=await workspaceDataExport(b);
      assert.equal(own.workspaceId,a.workspaceId);
      assert.ok((own.data.documents as {id:string}[]).some(r=>r.id===doc.id));
      assert.equal((other.data.documents as unknown[]).length,0);
      assert.ok(!JSON.stringify(other).includes(doc.id));
    });
    await t.test("revoked membership cannot retrieve exports or saved privacy requests",async()=>{
      await db.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.workspaceId,b.workspaceId));
      for(const action of[()=>workspaceDataExport(b),()=>customerAccount(b)])
        await assert.rejects(action,(e:unknown)=>e instanceof ValoProblem&&e.status===403);
    });
    await t.test("no staff permission, missing MFA and cross-area substitution all fail",async()=>{
      await assert.rejects(()=>staffOperations(staff,true,"finance"),/no active permission/);
      await db.insert(valoStaffAssignments).values({id:role,identityId:staff,role:"finance",grantedBy:"synthetic-fixture",
        reason:"Isolated service-level negative test; not an actual staff approval"});
      await assert.rejects(()=>staffOperations(staff,false,"finance"),/multi-factor/);
      await assert.rejects(()=>staffOperations(staff,true,"support"),/no active permission/);
      const r=await staffOperations(staff,true,"finance");
      assert.ok(r.records.every(record=>!Object.hasOwn(record,"body")&&!Object.hasOwn(record,"content")&&!Object.hasOwn(record,"line")));
      assert.match(r.notice,/Test-mode financial records/);
      assert.equal((await db.select().from(valoStaffAccessAudit).where(eq(valoStaffAccessAudit.assignmentId,role))).length,1);
      await db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.id,role));
      await assert.rejects(()=>staffOperations(staff,true,"finance"),/no active permission/);
    });
  }finally{
    await db.delete(valoStaffAccessAudit).where(eq(valoStaffAccessAudit.assignmentId,role));
    await db.delete(valoStaffAssignments).where(eq(valoStaffAssignments.id,role));
    for(const contact of[email,`burst-${run}@example.invalid`,`other-${run}@example.invalid`])
      await db.delete(valoAccessSupport).where(eq(valoAccessSupport.contactEmail,contact));
    await db.delete(valoDocumentRevisions).where(inArray(valoDocumentRevisions.workspaceId,ids));
    await db.delete(valoDocuments).where(inArray(valoDocuments.workspaceId,ids));
    await db.delete(valoPrivacyEvents).where(inArray(valoPrivacyEvents.workspaceId,ids));
    await db.delete(valoPrivacyTombstones).where(inArray(valoPrivacyTombstones.workspaceId,ids));
    await db.delete(valoPrivacyCases).where(inArray(valoPrivacyCases.workspaceId,ids));
    await db.delete(valoSupportTickets).where(inArray(valoSupportTickets.workspaceId,ids));
    await db.delete(valoEvents).where(inArray(valoEvents.workspaceId,ids));
    await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId,ids));
    await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id,ids));await pool.end();
  }
});
