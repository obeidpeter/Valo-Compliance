import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test,after } from "node:test";
import { eq,inArray,sql } from "drizzle-orm";
import { db,pool,valoWorkspaces,valoMemberships,valoDocuments,valoDocumentRevisions,
  valoProfileVersions,valoSupportTickets,valoEvents,valoRateBuckets } from "@workspace/db";
import { resolveWorkspace,saveProfile,createDocument,saveDocument,createTicket,type WorkspaceActor } from "./valo-store";
import { quotaSubjectHash,quotaPolicy } from "./valo-quota";
import { syntheticProfile,syntheticDocument } from "./valo-test-fixtures";
const enabled=process.env.VALO_RUN_DB_TESTS==="synthetic-development-only";
const workspaces:string[]=[],keys:string[]=[];
after(async()=>{
  if(enabled&&workspaces.length)await db.transaction(async tx=>{
    for(const table of[valoEvents,valoSupportTickets,valoDocumentRevisions,valoDocuments,valoProfileVersions,valoMemberships])
      await tx.delete(table).where(inArray(table.workspaceId,workspaces));
    await tx.delete(valoWorkspaces).where(inArray(valoWorkspaces.id,workspaces));
    await tx.delete(valoRateBuckets).where(inArray(valoRateBuckets.subjectHash,keys));
  });
  await pool.end();
});
async function actor(){
  const a=await resolveWorkspace(`synthetic-security-${randomUUID()}`);workspaces.push(a.workspaceId);
  keys.push(quotaSubjectHash(process.env.SESSION_SECRET,"user",a.identityId));return a;
}
const ticket={category:"support",scope:"Synthetic security test",contactEmail:"synthetic@example.test",sharingConsent:false};
async function seed(a:WorkspaceActor,operation:"profile"|"document"|"support",window:"minute"|"day",used:number){
  const bucket=`${operation}-write${window==="day"?"-day":""}`;
  const key=quotaSubjectHash(process.env.SESSION_SECRET,"user",a.identityId);
  await db.execute(sql`INSERT INTO valo_rate_buckets(bucket,subject_hash,window_started_at,used_count,expires_at)
    VALUES(${bucket},${key},date_trunc(${window},statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',${used},now()+interval '2 days')
    ON CONFLICT(bucket,subject_hash,window_started_at) DO UPDATE SET used_count=excluded.used_count`);
}
function limited(e:unknown){const p=e as {status:number;retryAfter:number;message:string};
  assert.equal(p.status,429);assert.ok(p.retryAfter>=1&&p.retryAfter<=86400);assert.match(p.message,/saved work is unchanged/);return true;
}
test("durable customer write ceilings preserve saved data",{skip:!enabled},async t=>{
  assert.equal(process.env.NODE_ENV,"development");
  for(const operation of["profile","document","support"]as const){
    await t.test(`${operation}: last minute allowance succeeds; excess is rejected without changing saved work`,async()=>{
      const a=await actor();
      const doc=operation==="document"?await createDocument(a,syntheticDocument):null;
      await seed(a,operation,"minute",quotaPolicy[`${operation}-write`]-1);
      if(operation==="profile"){
        await saveProfile(a,{expectedRevision:0,profile:syntheticProfile});
        await assert.rejects(()=>saveProfile(a,{expectedRevision:1,profile:syntheticProfile}),limited);
        const rows=await db.select().from(valoProfileVersions).where(eq(valoProfileVersions.workspaceId,a.workspaceId));
        assert.equal(rows.length,1);assert.deepEqual(rows[0].profile,syntheticProfile);
      }else if(operation==="document"){
        await saveDocument(a,doc!.id,{...syntheticDocument,title:"Last permitted synthetic revision",expectedRevision:1});
        await assert.rejects(()=>saveDocument(a,doc!.id,{...syntheticDocument,title:"Unsaved input must stay unsaved",expectedRevision:2}),limited);
        const rows=await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.workspaceId,a.workspaceId));
        assert.equal(rows.length,2);assert.ok(rows.some(r=>r.title==="Last permitted synthetic revision"));
        assert.ok(!rows.some(r=>r.title==="Unsaved input must stay unsaved"));
      }else{
        await createTicket(a,ticket);await assert.rejects(()=>createTicket(a,ticket),limited);
        assert.equal((await db.select().from(valoSupportTickets).where(eq(valoSupportTickets.workspaceId,a.workspaceId))).length,1);
      }
    });
    await t.test(`${operation}: daily cap remains after minute usage resets`,async()=>{
      const a=await actor();
      const doc=operation==="document"?await createDocument(a,syntheticDocument):null;
      await seed(a,operation,"day",quotaPolicy[`${operation}-write-day`]);await seed(a,operation,"minute",1);
      const write=()=>operation==="profile"?saveProfile(a,{expectedRevision:0,profile:syntheticProfile}):
        operation==="document"?saveDocument(a,doc!.id,{...syntheticDocument,expectedRevision:1}):createTicket(a,ticket);
      await assert.rejects(write,limited);
      const key=quotaSubjectHash(process.env.SESSION_SECRET,"user",a.identityId);
      const persisted=await pool.query("SELECT used_count FROM valo_rate_buckets WHERE subject_hash=$1 AND bucket=$2",[key,`${operation}-write-day`]);
      assert.equal(persisted.rows[0].used_count,quotaPolicy[`${operation}-write-day`]);
    });
  }
  await t.test("20 concurrent tickets create exactly three durable tickets, not20",async()=>{
    const a=await actor();const results=await Promise.allSettled(Array.from({length:20},()=>createTicket(a,ticket)));
    assert.equal(results.filter(r=>r.status==="fulfilled").length,3);
    for(const r of results)if(r.status==="rejected")limited(r.reason);
    assert.equal((await db.select().from(valoSupportTickets).where(eq(valoSupportTickets.workspaceId,a.workspaceId))).length,3);
  });
});
async function waitUntilBlocked(pid:number){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    const r=await pool.query("SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",[pid]);
    if(r.rowCount)return;
    await new Promise(r=>setTimeout(r,15));
  }
  throw Error("The tested writer never reached the actual blocking database lock");
}
test("revocation committed while a write is in flight prevents its eventual write",{skip:!enabled},async t=>{
  assert.equal(process.env.NODE_ENV,"development");
  for(const operation of["profile","document","support"]as const)await t.test(`${operation} real PostgreSQL revocation race`,async()=>{
    const a=await actor();const doc=operation==="document"?await createDocument(a,syntheticDocument):null;
    const blocker=await pool.connect();let pending:Promise<unknown>|undefined;
    try{
      await blocker.query("BEGIN");
      const pid=Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      if(operation==="support")await blocker.query("UPDATE valo_memberships SET active='no' WHERE workspace_id=$1",[a.workspaceId]);
      else await blocker.query(operation==="profile"?"SELECT id FROM valo_workspaces WHERE id=$1 FOR UPDATE":"SELECT id FROM valo_documents WHERE id=$1 FOR UPDATE",
        [doc?.id??a.workspaceId]);
      // Actor was resolved before revocation. There are no test-only hooks in the write path.
      const write=operation==="profile"?saveProfile(a,{expectedRevision:0,profile:syntheticProfile}):
        operation==="document"?saveDocument(a,doc!.id,{...syntheticDocument,expectedRevision:1}):createTicket(a,ticket);
      pending=write.then(()=>({wrote:true}),e=>({wrote:false,status:e.status}));
      await waitUntilBlocked(pid);
      if(operation!=="support")await db.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.workspaceId,a.workspaceId));
      await blocker.query("COMMIT");
      assert.deepEqual(await pending,{wrote:false,status:403});
      assert.equal((await db.select().from(valoProfileVersions).where(eq(valoProfileVersions.workspaceId,a.workspaceId))).length,0);
      assert.equal((await db.select().from(valoSupportTickets).where(eq(valoSupportTickets.workspaceId,a.workspaceId))).length,0);
      assert.equal((await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.workspaceId,a.workspaceId))).length,doc?1:0);
    }finally{await blocker.query("ROLLBACK");blocker.release();if(pending)await pending;}
  });
});
