import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn,type ChildProcess} from "node:child_process";
import {and,eq,sql} from "drizzle-orm";
import {db,pool,valoExportJobs,valoExportObjects,valoExportRequests,valoFileAssets,valoEvents,
  valoDocumentRevisions,valoDocuments,valoMemberships,valoWorkspaces} from "@workspace/db";
import {resolveWorkspace,createDocument} from "./valo-store";
import {requestExport,executeExport,getExport,listExports,retryExport,type ExportStage} from "./valo-exports";
import {recoverAbandonedExports,reconcileExportOrphans,EXPORT_LEASE_MS} from "./valo-export-recovery";
import {deletePrivateFile,readPrivateFile,writePrivateFile} from "./valo-private-storage";
import {syntheticDocument} from "./valo-test-fixtures";

const enabled=process.env.VALO_RUN_EXPORT_CRASH_TESTS==="synthetic-development-only";
test(`real process death, PostgreSQL lease fencing and ${process.env.VALO_PORTABLE_WORKER_PRELOADED==="true"
  ?"portable filesystem (not native storage)":"native private storage"} recovery`,
  {skip:!enabled,timeout:240000},async t=>{
  assert.equal(process.env.NODE_ENV,"development");assert.ok(!process.env.REPLIT_DEPLOYMENT);
  const a=await resolveWorkspace("synthetic-export-crash-"+randomUUID());
  const imports=["--import","tsx",...(process.env.VALO_PORTABLE_WORKER_PRELOADED==="true"
    ?["--experimental-test-module-mocks","--import",new URL("../test-support/private-file-process.mts",import.meta.url).href]:[])];
  let child:ChildProcess|undefined;
  async function kill(){if(!child||child.exitCode!==null||child.signalCode)return;
    const ended=new Promise<void>(r=>child!.once("exit",()=>r()));
    process.kill(-child.pid!,"SIGKILL");await ended;}
  async function expire(id:string){await db.update(valoExportJobs).set({updatedAt:new Date(Date.now()-EXPORT_LEASE_MS-1000)}).where(eq(valoExportJobs.id,id));}
  async function create(){
    const doc=await createDocument(a,{...syntheticDocument,title:"Synthetic crash drill "+randomUUID()});
    return {doc,job:await requestExport(a,doc.id,randomUUID(),{revisionId:doc.revisionId,format:"pdf",acknowledgeDraft:true})};
  }
  async function pause(id:string,stage:ExportStage,realWorker=false){
    const {job}=await getExport(a,id);
    child=spawn(process.execPath,[...imports,...(realWorker?["src/workers/export-worker.ts"]:
      ["src/scripts/export-crash-child.ts",id,a.workspaceId,job.queueId,stage])],
      {cwd:process.cwd(),env:{...process.env,NODE_ENV:"development",
        ...(realWorker?{VALO_EXPORT_CRASH_JOB:id,VALO_EXPORT_CRASH_STAGE:stage}:{})},
        detached:true,stdio:["ignore","ignore","pipe","ipc"]});
    let diagnostic="";
    child.stderr?.on("data",bytes=>{diagnostic=(diagnostic+String(bytes)).slice(-2000);});
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("Child did not reach "+stage)),35000);
      child!.once("message",m=>{clearTimeout(timer);assert.equal((m as {stage:string}).stage,stage);resolve();});
      child!.once("exit",()=>{clearTimeout(timer);reject(Error("Child exited before "+stage+": "+diagnostic));});
    });
    await kill();
    if(realWorker){
      const result=await db.execute(sql`select state from valo_jobs.job where id=${job.queueId}::uuid`);
      assert.equal(result.rows[0]?.state,"active","real transport delivery was claimed and never acknowledged");
    }
  }
  try{
    for(const stage of["claiming","claimed","rendering","uploading","uploaded","completing","completed"] as const){
      await t.test("SIGKILL on final attempt at "+stage,async()=>{
        const {doc,job}=await create();
        await db.update(valoExportJobs).set({attempts:2}).where(eq(valoExportJobs.id,job.id));
        await pause(job.id,stage);
        let current=(await getExport(a,job.id)).job;
        if(stage==="claiming"){
          assert.equal(current.status,"queued");assert.equal(current.attempts,2,"uncommitted claim rolled back");
        }else if(stage==="completed"){
          assert.equal(current.status,"ready");
        }else{
          assert.equal(current.status,"running");assert.equal(current.attempts,3);
          await expire(job.id);
          assert.equal(await recoverAbandonedExports(job.id),1);
          assert.equal((await getExport(a,job.id)).job.status,"failed","last attempt is explicitly retryable, not permanently running");
          await reconcileExportOrphans(job.id);
          const objects=await db.select().from(valoExportObjects).where(eq(valoExportObjects.jobId,job.id));
          for(const object of objects)await assert.rejects(()=>readPrivateFile(object.objectKey,"not-a-valid-checksum"),/PRIVATE_STORAGE_READ_FAILED/);
          if(stage==="uploaded"){
            assert.equal(objects.length,1);
            // Real late write after a successful cleanup; a retained tombstone must remove it again.
            await writePrivateFile(objects[0]!.objectKey,Buffer.from("synthetic delayed upload"));
            await db.update(valoExportObjects).set({nextCleanupAt:new Date(0)}).where(eq(valoExportObjects.jobId,job.id));
            assert.equal((await reconcileExportOrphans(job.id)).cleaned,1);
            await assert.rejects(()=>readPrivateFile(objects[0]!.objectKey,"invalid"),/PRIVATE_STORAGE_READ_FAILED/);
          }
          assert.equal((await retryExport(a,job.id)).status,"queued");
          await executeExport(job.id,a.workspaceId,current.queueId);
          assert.equal((await getExport(a,job.id)).job.attempts,0,"old generation cannot write after recovery");
        }
        current=(await getExport(a,job.id)).job;
        await Promise.all([executeExport(job.id,a.workspaceId,current.queueId),executeExport(job.id,a.workspaceId,current.queueId)]);
        assert.equal((await getExport(a,job.id)).job.status,"ready");
        assert.equal((await listExports(a,doc.id)).length,1);
        assert.equal((await db.select().from(valoFileAssets).where(eq(valoFileAssets.jobId,job.id))).length,1);
        assert.equal((await db.select().from(valoEvents).where(and(eq(valoEvents.entityId,job.id),eq(valoEvents.action,"export.ready")))).length,1);
      });
    }
    await t.test("first attempt recovers automatically, only one recovery wins and live leases are not stolen",async()=>{
      const {job}=await create();await pause(job.id,"claimed");
      assert.equal(await recoverAbandonedExports(job.id),0);
      await expire(job.id);
      const recovered=await Promise.all([recoverAbandonedExports(job.id),recoverAbandonedExports(job.id)]);
      assert.equal(recovered.reduce((a,b)=>a+b,0),1);
      const current=(await getExport(a,job.id)).job;assert.equal(current.status,"queued");assert.equal(current.attempts,1);
      await executeExport(job.id,a.workspaceId,current.queueId);
      assert.equal((await getExport(a,job.id)).job.status,"ready");
    });
    await t.test("explicit retry cycles remain bounded and source revision remains saved",async()=>{
      const {doc,job}=await create();
      for(let i=0;i<3;i++){
        await db.update(valoExportJobs).set({status:"running",attempts:3}).where(eq(valoExportJobs.id,job.id));
        await expire(job.id);await recoverAbandonedExports(job.id);await retryExport(a,job.id);
      }
      await db.update(valoExportJobs).set({status:"running",attempts:3}).where(eq(valoExportJobs.id,job.id));
      await expire(job.id);await recoverAbandonedExports(job.id);
      await assert.rejects(()=>retryExport(a,job.id),{status:409});
      assert.equal((await getExport(a,job.id)).job.status,"failed");
      assert.equal((await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.id,doc.revisionId))).length,1);
    });
    await t.test("stale queued transport deliveries become retryable even if claim never committed",async()=>{
      const {job}=await create();
      for(let i=0;i<3;i++){await expire(job.id);await recoverAbandonedExports(job.id);}
      const failed=(await getExport(a,job.id)).job;
      assert.equal(failed.status,"failed");assert.equal(failed.attempts,0);assert.equal(failed.leaseRecoveries,3);
      assert.equal((await retryExport(a,job.id)).status,"queued");
    });
    await t.test("real dispatcher restart detects final-attempt abandonment and completes explicit retry",async()=>{
      const {job}=await create();
      await db.update(valoExportJobs).set({attempts:2}).where(eq(valoExportJobs.id,job.id));
      await pause(job.id,"claimed",true);await expire(job.id);
      child=spawn(process.execPath,[...imports,"src/workers/export-worker.ts"],
        {cwd:process.cwd(),env:{...process.env,NODE_ENV:"development"},detached:true,stdio:"ignore"});
      const end=Date.now()+30000;
      // Raw database read proves the daemon, not getExport's fallback, performed recovery.
      while(Date.now()<end){
        const [row]=await db.select().from(valoExportJobs).where(eq(valoExportJobs.id,job.id));
        if(row?.status==="failed")break;await new Promise(r=>setTimeout(r,200));
      }
      assert.equal((await getExport(a,job.id)).job.status,"failed");
      await retryExport(a,job.id);
      const readyBy=Date.now()+30000;
      while(Date.now()<readyBy&&(await getExport(a,job.id)).job.status!=="ready")await new Promise(r=>setTimeout(r,200));
      assert.equal((await getExport(a,job.id)).job.status,"ready");
      assert.equal((await db.select().from(valoFileAssets).where(eq(valoFileAssets.jobId,job.id))).length,1);
      const retained=(await getExport(a,job.id)).asset!;
      await db.update(valoFileAssets).set({retentionAt:new Date(0)}).where(eq(valoFileAssets.id,retained.id));
      const expiryBy=Date.now()+30000;
      while(Date.now()<expiryBy){
        const [row]=await db.select().from(valoExportJobs).where(eq(valoExportJobs.id,job.id));
        if(row?.errorCode==="EXPORT_EXPIRED")break;await new Promise(r=>setTimeout(r,200));
      }
      assert.equal((await getExport(a,job.id)).job.errorCode,"EXPORT_EXPIRED","actual dispatcher retires expired bytes");
      assert.equal((await getExport(a,job.id)).asset,null);
      await kill();
    });
  }finally{
    await kill();
    const objects=await db.select().from(valoExportObjects).where(eq(valoExportObjects.workspaceId,a.workspaceId));
    for(const o of objects)await deletePrivateFile(o.objectKey);
    for(const table of [valoExportObjects,valoFileAssets,valoExportRequests,valoExportJobs,valoEvents,
      valoDocumentRevisions,valoDocuments,valoMemberships])await db.delete(table).where(eq(table.workspaceId,a.workspaceId));
    await db.delete(valoWorkspaces).where(eq(valoWorkspaces.id,a.workspaceId));
    await pool.end();
  }
});
