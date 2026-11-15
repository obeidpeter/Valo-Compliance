import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {fork,type ChildProcess} from "node:child_process";
import {fileURLToPath} from "node:url";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,join} from "node:path";
import {eq,inArray,sql} from "drizzle-orm";
import {db,pool,valoWorkspaceExports as jobs,valoFileAssets,valoExportObjects,valoEvents,valoWorkspaces,
  valoMemberships,valoExportJobs,valoExportRequests,valoDocuments,valoDocumentRevisions,valoPrivacyCases,
  valoPrivacyEvents,valoPrivacyTombstones,valoPrivacyErasureObjects,valoStaffAssignments,valoStaffAccessAudit,valoSupportTickets} from "@workspace/db";
import {resolveWorkspace,createDocument} from "./valo-store";
import {requestWorkspaceExport,getWorkspaceExport,listWorkspaceExports,actOnWorkspaceExport,executeWorkspaceExport,
  recoverWorkspaceExports,expireWorkspaceExports,withPreparedWorkspaceExport} from "./valo-workspace-exports";
import {fixtureWorkspaceStorage} from "./test-support/workspace-export-storage";
import {syntheticDocument} from "./valo-test-fixtures";
import {requestExport} from "./valo-exports";
import {reconcileExportOrphans} from "./valo-export-recovery";
import {createPrivacyCase,confirmPrivacyCase,simpleStaffPrivacyAction} from "./valo-privacy";
import {processPrivacyErasure,closePrivacyErasureLocks} from "./valo-privacy-erasure";
const reason="Controlled synthetic durable-export lifecycle proof; no customer/provider data.";
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};

test("durable workspace exports use real PostgreSQL, leases and private fixture files",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",timeout:180000,
},async t=>{
  assert.equal(process.env.NODE_ENV,"development");assert.ok(!process.env.REPLIT_DEPLOYMENT);
  assert.ok(process.env.DATABASE_URL);
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(new URL(process.env.DATABASE_URL).hostname),"Disposable loopback PostgreSQL only");
  const directory=await mkdtemp(join(tmpdir(),"valo-workspace-fixture-")),storage=fixtureWorkspaceStorage(directory);
  const owners:string[]=[],operators:string[]=[],children:ChildProcess[]=[];
  const owner=async()=>{const actor=await resolveWorkspace("synthetic-workspace-export-"+randomUUID());owners.push(actor.workspaceId);return actor;};
  type Actor=Awaited<ReturnType<typeof owner>>;
  const raw=async(id:string)=>(await db.select().from(jobs).where(eq(jobs.id,id)))[0]!;
  const prepare=async(actor:Actor)=>{const view=await requestWorkspaceExport(actor,{idempotencyKey:randomUUID()}),row=await raw(view.id);
    await executeWorkspaceExport(row.id,actor.workspaceId,row.queueId,{storage});return raw(row.id);};
  const a=await owner(),b=await owner();
  try{
    await t.test("idempotency, one active request, tenant isolation and bounded private DTO",async()=>{
      const key=randomUUID();const views=await Promise.all([requestWorkspaceExport(a,{idempotencyKey:key}),requestWorkspaceExport(a,{idempotencyKey:key})]);
      assert.equal(views[0]!.id,views[1]!.id);assert.equal((await listWorkspaceExports(a)).items.length,1);
      await assert.rejects(()=>requestWorkspaceExport(a,{idempotencyKey:randomUUID()}),{status:409});
      await assert.rejects(()=>getWorkspaceExport(b,views[0]!.id),{status:404});
      const encoded=JSON.stringify(views[0]);for(const key of["queueId","objectKey","leaseExpiresAt","requestedBy"])assert.ok(!encoded.includes(key));
      await actOnWorkspaceExport(a,views[0]!.id,{expectedVersion:views[0]!.version},"cancel");
      assert.equal((await requestWorkspaceExport(a,{idempotencyKey:key})).status,"cancelled");
    });
    await t.test("paged collection above 8 MB persists, survives reload and releases a verified complete snapshot",async()=>{
      await db.insert(valoEvents).values(Array.from({length:6001},(_,i)=>({id:randomUUID(),workspaceId:a.workspaceId,actorId:a.identityId,
        action:`synthetic-page-${i}-${"x".repeat(1400)}`,entityId:a.workspaceId})));
      await db.insert(valoEvents).values({id:randomUUID(),workspaceId:b.workspaceId,actorId:b.identityId,action:"OTHER_TENANT_SECRET",entityId:b.workspaceId});
      const row=await prepare(a);assert.equal(row.status,"ready");assert.ok(row.bytesPrepared>8_000_000);assert.ok(row.rowsProcessed>=6001);
      let sessions=0;const result=await withPreparedWorkspaceExport(a,row.id,async path=>JSON.parse(await readFile(path,"utf8")),{
        storage,beforeRelease:async()=>{sessions++;}});
      assert.equal(sessions,1);assert.equal(result.data.yourActivity.length,6001);assert.ok(!JSON.stringify(result).includes("OTHER_TENANT_SECRET"));
      assert.match(result.scope,/not complete privacy fulfilment/);assert.equal((await getWorkspaceExport(a,row.id)).status,"ready");
      await assert.rejects(()=>withPreparedWorkspaceExport(b,row.id,async()=>assert.fail("cross-tenant release"),{storage,beforeRelease:async()=>{}}),{status:404});
    });
    await t.test("session failure, membership revocation and cancellation after storage wait release zero bytes",async()=>{
      for(const mode of["session","membership","cancel"]){
        const row=await prepare(a);assert.equal(row.status,"ready");let releases=0,checks=0;
        await assert.rejects(()=>withPreparedWorkspaceExport(a,row.id,async()=>{releases++;},{storage,beforeRelease:async()=>{
          checks++;if(mode==="session")throw Error("CONTROLLED_REVOKED_SESSION");
          if(mode==="membership")await db.update(valoMemberships).set({active:"no"}).where(eq(valoMemberships.workspaceId,a.workspaceId));
          if(mode==="cancel")await actOnWorkspaceExport(a,row.id,{expectedVersion:row.version},"cancel");
        }}),mode==="session"?/CONTROLLED_REVOKED_SESSION/:{status:mode==="membership"?403:409});assert.equal(releases,0);assert.equal(checks,1);
        if(mode==="cancel")assert.equal((await raw(row.id)).status,"cancelled");
        if(mode==="membership")await db.update(valoMemberships).set({active:"yes"}).where(eq(valoMemberships.workspaceId,a.workspaceId));
      }
    });
    await t.test("cancellation wins against an already accepted upload and stale completion",async()=>{
      const actor=await owner(),view=await requestWorkspaceExport(actor,{idempotencyKey:randomUUID()}),row=await raw(view.id);
      const reached=deferred(),release=deferred();const work=executeWorkspaceExport(row.id,actor.workspaceId,row.queueId,{storage,onStage:async stage=>{
        if(stage==="uploaded"){reached.resolve();await release.promise;}
      }});
      await reached.promise;const running=await getWorkspaceExport(actor,row.id);await actOnWorkspaceExport(actor,row.id,{expectedVersion:running.version},"cancel");
      release.resolve();await work;assert.equal((await raw(row.id)).status,"cancelled");
      assert.equal((await db.select().from(valoFileAssets).where(eq(valoFileAssets.workspaceExportJobId,row.id))).length,0);
      const[reservation]=await db.select().from(valoExportObjects).where(eq(valoExportObjects.workspaceExportJobId,row.id));assert.equal(reservation!.state,"cleanup");
      await reconcileExportOrphans(undefined,storage.remove);await assert.rejects(readFile(join(directory,basename(reservation!.objectKey))));
      // A provider accepted before cancellation can finish after the first delete.
      await writeFile(join(directory,basename(reservation!.objectKey)),"synthetic late accepted bytes");
      await db.update(valoExportObjects).set({nextCleanupAt:new Date(0)}).where(eq(valoExportObjects.objectKey,reservation!.objectKey));
      await reconcileExportOrphans(undefined,storage.remove);await assert.rejects(readFile(join(directory,basename(reservation!.objectKey))));
    });
    await t.test("membership revocation plus cancellation cannot deadlock snapshot progress",async()=>{
      const actor=await owner(),view=await requestWorkspaceExport(actor,{idempotencyKey:randomUUID()}),row=await raw(view.id);
      const collecting=deferred(),continueProgress=deferred();let paused=false;
      const work=executeWorkspaceExport(row.id,actor.workspaceId,row.queueId,{storage,onStage:async stage=>{
        if(stage==="collecting"&&!paused){paused=true;collecting.resolve();await continueProgress.promise;}
      }});
      await collecting.promise;
      const revoker=await pool.connect(),jobBlocker=await pool.connect();let revoked:Promise<unknown>|undefined,cancelled:Promise<unknown>|undefined;
      try{
        // Hold the job lock explicitly: PostgreSQL may otherwise grant a new
        // compatible SHARE lock before a waiting updater, so a second wait is
        // not a deterministic way to test the dangerous progress dependency.
        await jobBlocker.query("begin");await jobBlocker.query("select id from valo_workspace_exports where id=$1 for update",[row.id]);
        const pid=(await revoker.query("select pg_backend_pid() as pid")).rows[0].pid;
        revoked=revoker.query("update valo_memberships set active='no' where workspace_id=$1",[actor.workspaceId]);
        const waitFor=async(predicate:()=>Promise<boolean>)=>{
          const end=Date.now()+5000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}
          assert.fail("Expected controlled PostgreSQL lock wait was not observed");
        };
        await waitFor(async()=>!!(await pool.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[pid])).rowCount);
        const running=await raw(row.id);
        cancelled=actOnWorkspaceExport(actor,row.id,{expectedVersion:running.version},"cancel").catch(error=>error);
        // The real cancellation now waits for the controlled job holder while
        // membership revocation waits for the real collecting snapshot.
        await waitFor(async()=>!!(await pool.query("select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%valo_workspace_exports%' and query like '%for update%' limit 1")).rowCount);
        continueProgress.resolve();
        // Nonblocking heartbeat must release the snapshot BEFORE the job lock
        // is released. Otherwise revocation cannot finish and this times out.
        await Promise.race([revoked,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error("CONTROLLED_LOCK_CYCLE_NOT_RELEASED")),5000).unref())]);
        await jobBlocker.query("commit");
        const result=await Promise.all([work,revoked,cancelled]);
        assert.equal((result[2] as {status:number}).status,403);
        assert.notEqual((await raw(row.id)).status,"ready");
        assert.equal((await db.select().from(valoFileAssets).where(eq(valoFileAssets.workspaceExportJobId,row.id))).length,0);
      }finally{continueProgress.resolve();await jobBlocker.query("rollback");await revoked;await cancelled;jobBlocker.release();revoker.release();}
    });
    for(const stage of["claimed","uploaded","completing"] as const){
      await t.test(`kernel SIGKILL at ${stage}, lease recovery and duplicate generation fencing`,async()=>{
        const actor=await owner(),view=await requestWorkspaceExport(actor,{idempotencyKey:randomUUID()}),row=await raw(view.id);
        const child=fork(fileURLToPath(new URL("../scripts/workspace-export-crash-child.ts",import.meta.url)),[row.id,actor.workspaceId,row.queueId,stage,directory],{
          execArgv:["--import","tsx"],env:process.env,stdio:["ignore","ignore","pipe","ipc"]});children.push(child);
        let stderr="";child.stderr?.on("data",chunk=>{stderr+=String(chunk).slice(0,1000);});
        await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Child stage timeout "+stage+stderr)),20000);
          child.once("message",message=>{clearTimeout(timer);assert.equal((message as {stage:string}).stage,stage);resolve();});
          child.once("exit",()=>{clearTimeout(timer);reject(Error("Child exited before stage "+stage+stderr));});});
        const ended=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGKILL");await ended;
        assert.equal((await raw(row.id)).status,"running");assert.equal((await db.select().from(valoFileAssets).where(eq(valoFileAssets.workspaceExportJobId,row.id))).length,0);
        assert.equal(await recoverWorkspaceExports(),0,"a live lease is not stolen");
        await db.update(jobs).set({leaseExpiresAt:new Date(0)}).where(eq(jobs.id,row.id));
        const recovered=await Promise.all([recoverWorkspaceExports(),recoverWorkspaceExports()]);assert.equal(recovered.reduce((x,y)=>x+y,0),1);
        const next=await raw(row.id);assert.notEqual(next.queueId,row.queueId);
        await executeWorkspaceExport(row.id,actor.workspaceId,row.queueId,{storage});assert.equal((await raw(row.id)).attempts,1);
        await Promise.all([executeWorkspaceExport(row.id,actor.workspaceId,next.queueId,{storage}),executeWorkspaceExport(row.id,actor.workspaceId,next.queueId,{storage})]);
        assert.equal((await raw(row.id)).status,"ready");assert.equal((await db.select().from(valoFileAssets).where(eq(valoFileAssets.workspaceExportJobId,row.id))).length,1);
      });
    }
    await t.test("automatic failures, manual retry version and expiry remain bounded and honest",async()=>{
      const actor=await owner(),view=await requestWorkspaceExport(actor,{idempotencyKey:randomUUID()});
      for(let attempt=0;attempt<3;attempt++){
        const row=await raw(view.id);await db.update(jobs).set({nextAttemptAt:new Date(0)}).where(eq(jobs.id,row.id));
        await executeWorkspaceExport(row.id,actor.workspaceId,row.queueId,{storage:{...storage,write:async()=>{throw Error("CONTROLLED_STORAGE_UNAVAILABLE");}}});
      }
      let row=await raw(view.id);assert.equal(row.status,"failed");assert.equal(row.attempts,3);
      await assert.rejects(()=>actOnWorkspaceExport(actor,row.id,{expectedVersion:1},"retry"),{status:409});
      await actOnWorkspaceExport(actor,row.id,{expectedVersion:row.version},"retry");row=await raw(row.id);
      assert.equal(row.retryCycles,1);await executeWorkspaceExport(row.id,actor.workspaceId,row.queueId,{storage});
      await db.update(jobs).set({expiresAt:new Date(0)}).where(eq(jobs.id,row.id));
      assert.equal((await getWorkspaceExport(actor,row.id)).downloadUrl,null);
      await assert.rejects(()=>withPreparedWorkspaceExport(actor,row.id,async()=>assert.fail("expired release"),{storage,beforeRelease:async()=>{}}),{status:409});
      await expireWorkspaceExports();assert.equal((await raw(row.id)).status,"expired");
      const[asset]=await db.select().from(valoFileAssets).where(eq(valoFileAssets.workspaceExportJobId,row.id));assert.ok(asset!.withdrawnAt);
    });
    await t.test("mixed document/workspace assets survive normal cleanup; held cancelled JSON remains tracked",async()=>{
      const actor=await owner(),workspaceJob=await prepare(actor),document=await createDocument(actor,syntheticDocument);
      const docView=await requestExport(actor,document.id,randomUUID(),{revisionId:document.revisionId,format:"docx",acknowledgeDraft:true});
      const[docJob]=await db.select().from(valoExportJobs).where(eq(valoExportJobs.id,docView.id));
      const docKey=`valo/development/${actor.workspaceId}/${randomUUID()}.docx`;
      await db.insert(valoExportObjects).values({objectKey:docKey,workspaceId:actor.workspaceId,jobId:docJob!.id,queueId:docJob!.queueId,state:"cleanup"});
      await db.insert(valoFileAssets).values({id:randomUUID(),workspaceId:actor.workspaceId,jobId:docJob!.id,objectKey:docKey,checksum:"a".repeat(64),size:1,mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
      await db.update(valoExportObjects).set({state:"cleanup",nextCleanupAt:new Date(0)}).where(eq(valoExportObjects.workspaceExportJobId,workspaceJob.id));
      const removed:string[]=[];await reconcileExportOrphans(undefined,async key=>{removed.push(key);await storage.remove(key);});
      assert.ok(!removed.includes(docKey));const[jsonAsset]=await db.select().from(valoFileAssets).where(eq(valoFileAssets.workspaceExportJobId,workspaceJob.id));assert.ok(!removed.includes(jsonAsset!.objectKey));
      const staff={identityId:"synthetic-workspace-privacy-"+randomUUID(),recentMfa:true,verifiedAt:Date.now()};operators.push(staff.identityId);
      await db.insert(valoStaffAssignments).values({id:randomUUID(),identityId:staff.identityId,role:"privacy",grantedBy:"synthetic",reason});
      const created=await createPrivacyCase(actor,"synthetic@example.invalid",{kind:"deletion",idempotencyKey:randomUUID(),message:reason,acknowledgement:true}),caseId=created.reference.slice(5);
      let detail=await confirmPrivacyCase(actor,caseId,{expectedVersion:1,acknowledgement:true});
      detail=await simpleStaffPrivacyAction(staff,caseId,{action:"claim",expectedVersion:detail.request.version,reason});
      detail=await simpleStaffPrivacyAction(staff,caseId,{action:"hold",expectedVersion:detail.request.version,reason});
      await actOnWorkspaceExport(actor,workspaceJob.id,{expectedVersion:workspaceJob.version},"cancel");
      let heldCalls=0;await reconcileExportOrphans(undefined,async key=>{if(key===jsonAsset!.objectKey)heldCalls++;});assert.equal(heldCalls,0);
      assert.equal((await db.select().from(valoFileAssets).where(eq(valoFileAssets.id,jsonAsset!.id))).length,1);
      detail=await simpleStaffPrivacyAction(staff,caseId,{action:"release_hold",expectedVersion:detail.request.version,reason});
      // Pending keys of BOTH families must be captured before their future uploads.
      const pending=await requestWorkspaceExport(actor,{idempotencyKey:randomUUID()}),pendingRow=await raw(pending.id);
      const futureJson=`valo/development/${actor.workspaceId}/${randomUUID()}.json`,futureDoc=`valo/development/${actor.workspaceId}/${randomUUID()}.pdf`;
      await db.insert(valoExportObjects).values([{objectKey:futureJson,workspaceId:actor.workspaceId,workspaceExportJobId:pending.id,queueId:pendingRow.queueId,state:"pending"},
        {objectKey:futureDoc,workspaceId:actor.workspaceId,jobId:docJob!.id,queueId:docJob!.queueId,state:"pending"}]);
      detail=await processPrivacyErasure(staff,caseId,{action:"start_erasure",expectedVersion:detail.request.version,reason,acknowledgement:true},storage.remove);
      detail=await processPrivacyErasure(staff,caseId,{action:"resume_erasure",expectedVersion:detail.request.version,reason,acknowledgement:true},storage.remove);
      const captured=await db.select().from(valoPrivacyErasureObjects).where(eq(valoPrivacyErasureObjects.caseId,caseId));
      for(const key of[docKey,jsonAsset!.objectKey,futureJson,futureDoc])assert.ok(captured.some(item=>item.objectKey===key));
      assert.equal((await raw(pending.id)).status,"cancelled");
      await assert.rejects(()=>requestWorkspaceExport(actor,{idempotencyKey:randomUUID()}),{status:403});
      detail=await simpleStaffPrivacyAction(staff,caseId,{action:"hold",expectedVersion:detail.request.version,reason});
      let quarantineCalls=0;await reconcileExportOrphans(undefined,async key=>{if(key.includes(actor.workspaceId))quarantineCalls++;});assert.equal(quarantineCalls,0);
      // Sealed inventory trigger denies any attempt to mutate its captured keys.
      await assert.rejects(db.insert(valoPrivacyErasureObjects).values({caseId,workspaceId:actor.workspaceId,objectKey:`valo/development/${actor.workspaceId}/${randomUUID()}.json`}));
    });
  }finally{
    for(const child of children)if(child.exitCode===null&&!child.signalCode)child.kill("SIGKILL");
    // Synthetic fixture cleanup only. Disable the immutable-inventory guard only
    // inside this rollback-style fixture teardown transaction, never application code.
    await db.transaction(async tx=>{
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      for(const table of[valoPrivacyErasureObjects,valoPrivacyEvents,valoPrivacyTombstones,valoPrivacyCases,valoExportRequests,
        valoFileAssets,valoExportObjects,jobs,valoExportJobs,valoDocumentRevisions,valoDocuments,valoSupportTickets,valoEvents,valoMemberships])
        await tx.delete(table).where(inArray(table.workspaceId,owners));
      await tx.delete(valoWorkspaces).where(inArray(valoWorkspaces.id,owners));
      await tx.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId,operators));
      await tx.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId,operators));
    });
    await closePrivacyErasureLocks();await pool.end();await rm(directory,{recursive:true,force:true});
  }
});
