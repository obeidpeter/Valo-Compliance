import {test} from "node:test";
import {Pool} from "pg";
import {withPrivacyCaseLock} from "./valo-erasure-lock";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {fork,type ChildProcess} from "node:child_process";
import {fileURLToPath} from "node:url";
import {eq,inArray,sql} from "drizzle-orm";
import {db,pool,valoPrivacyErasureObjects,valoPrivacyCases,valoPrivacyEvents,valoPrivacyTombstones,
  valoWorkspaces,valoMemberships,valoStaffAssignments,valoStaffAccessAudit,valoProfileVersions,
  valoDocuments,valoDocumentRevisions,valoSupportTickets,valoEvents,valoExportRequests,valoFileAssets,
  valoExportObjects,valoExportJobs} from "@workspace/db";
import {resolveWorkspace,createDocument} from "./valo-store";
import {syntheticDocument} from "./valo-test-fixtures";
import {RENDER_VERSION} from "./valo-render";
import {createPrivacyCase,confirmPrivacyCase,simpleStaffPrivacyAction} from "./valo-privacy";
import {processPrivacyErasure,replayErasureObjects,replayErasedApplication,reconcileErasedObjects,closePrivacyErasureLocks} from "./valo-privacy-erasure";
import {requestExport,executeExport} from "./valo-exports";
import {reconcileExportOrphans} from "./valo-export-recovery";
import {privacyKeys,privacySigner} from "./valo-privacy-keys";
import {assertDevelopmentRuntime} from "./valo-development-runtime";

const reason="Controlled synthetic erasure race and recovery proof; no production or provider deletion.";
test("erasure holds, bounded recovery and accepted-upload process death",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",timeout:120000,
},async t=>{
  assertDevelopmentRuntime();
  const owners:string[]=[],operators:string[]=[],children:ChildProcess[]=[];
  const setup=async()=>{
    const run=randomUUID(),owner=await resolveWorkspace(`synthetic-erasure-race-${run}`);
    owners.push(owner.workspaceId);
    const actor={identityId:`synthetic-erasure-operator-${run}`,recentMfa:true,verifiedAt:Date.now()};operators.push(actor.identityId);
    await db.insert(valoStaffAssignments).values({id:randomUUID(),identityId:actor.identityId,role:"privacy",grantedBy:"synthetic-test",reason});
    const document=await createDocument(owner,syntheticDocument);
    const created=await createPrivacyCase(owner,"synthetic@example.invalid",{kind:"deletion",idempotencyKey:randomUUID(),message:reason,acknowledgement:true});
    const id=created.reference.slice(5);
    let detail=await confirmPrivacyCase(owner,id,{expectedVersion:1,acknowledgement:true});
    detail=await simpleStaffPrivacyAction(actor,id,{action:"claim",expectedVersion:detail.request.version,reason});
    return{owner,actor,document,id,version:detail.request.version,started:false};
  };
  type Fixture=Awaited<ReturnType<typeof setup>>;
  const fresh=(f:Fixture)=>({...f.actor,verifiedAt:Date.now()});
  const step=async(f:Fixture,remove:(key:string)=>Promise<void>)=>{
    const detail=await processPrivacyErasure(fresh(f),f.id,{action:f.started?"resume_erasure":"start_erasure",
      expectedVersion:f.version,reason,acknowledgement:true},remove);
    f.started=true;f.version=detail.request.version;return detail;
  };
  const finish=async(f:Fixture,remove:(key:string)=>Promise<void>)=>{
    for(let n=0;n<80;n++){const d=await step(f,remove);if(d.request.status==="partially_fulfilled")return d;}
    throw Error("CONTROLLED_ERASURE_DID_NOT_FINISH");
  };
  const exportJob=async(f:Fixture)=>{
    const created=await requestExport(f.owner,f.document.id,randomUUID(),{
      revisionId:f.document.revisionId,format:"docx",acknowledgeDraft:true});
    const[job]=await db.select().from(valoExportJobs).where(eq(valoExportJobs.id,created.id));return job;
  };
  const assertWrongCurrentKey=async(run:(remove:(key:string)=>Promise<void>)=>Promise<unknown>,caseId:string)=>{
    const original=process.env.VALO_PRIVACY_KEYRING,ring=privacyKeys(),current=`synthetic-erasure-key-${randomUUID()}`;
    const pinned={current,keys:{...ring.keys,[current]:"controlled-pinned-test-key-".repeat(3)}};
    await db.transaction(tx=>privacySigner(tx,pinned));
    const[before]=await db.select().from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.caseId,caseId));
    let calls=0;
    try{
      process.env.VALO_PRIVACY_KEYRING=JSON.stringify({...pinned,keys:{...pinned.keys,[current]:"controlled-wrong-test-key-".repeat(3)}});
      await assert.rejects(()=>run(async()=>{calls++;}),{status:503});assert.equal(calls,0);
      process.env.VALO_PRIVACY_KEYRING=JSON.stringify({current,keys:{[current]:pinned.keys[current]}});
      await assert.rejects(()=>run(async()=>{calls++;}),{status:503});assert.equal(calls,0);
      const[after]=await db.select().from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.caseId,caseId));
      assert.deepEqual(after.replayState,before.replayState);
    }finally{
      if(original===undefined)delete process.env.VALO_PRIVACY_KEYRING;else process.env.VALO_PRIVACY_KEYRING=original;
      await db.execute(sql`DELETE FROM valo_privacy_key_versions WHERE id=${current}`);
    }
  };
  try{
    await t.test("distinct advisory locks cannot exhaust a one-connection shared data pool",async()=>{
      const data=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:1000,allowExitOnIdle:true});
      const locks=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:1000,allowExitOnIdle:true});
      try{
        const results=await Promise.all(Array.from({length:6},()=>withPrivacyCaseLock(locks,randomUUID(),async()=>{
          const config={text:"SELECT 1 AS value",query_timeout:1000};
          const r=await data.query(config);return r.rows[0].value;
        })));
        assert.deepEqual(results,[1,1,1,1,1,1]);
      }finally{await locks.end();await data.end();}
    });
    await t.test("holds and revoked roles stop the next object, while an in-flight result remains recorded",async()=>{
      const f=await setup(),keys=Array.from({length:23},()=>`valo/development/${f.owner.workspaceId}/${randomUUID()}.pdf`).sort();
      await db.insert(valoPrivacyErasureObjects).values(keys.map(objectKey=>({caseId:f.id,workspaceId:f.owner.workspaceId,objectKey})));
      await db.insert(valoDocuments).values(Array.from({length:205},()=>({id:randomUUID(),workspaceId:f.owner.workspaceId})));
      await step(f,async()=>{});
      await assertWrongCurrentKey(remove=>step(f,remove),f.id);
      let dispatched=0,heldVersion=0;
      await assert.rejects(()=>step(f,async()=>{
        dispatched++;
        if(dispatched===1){const held=await simpleStaffPrivacyAction(fresh(f),f.id,{action:"hold",expectedVersion:f.version,reason});heldVersion=held.request.version;}
      }),{status:409});
      assert.equal(dispatched,1);
      assert.equal((await db.select().from(valoPrivacyErasureObjects).where(eq(valoPrivacyErasureObjects.caseId,f.id))).filter(x=>x.status==="deleted").length,1);
      f.version=heldVersion;
      await assert.rejects(()=>simpleStaffPrivacyAction(fresh(f),f.id,{action:"claim",expectedVersion:f.version,reason}),{status:409});
      const resumed=await simpleStaffPrivacyAction(fresh(f),f.id,{action:"release_hold",expectedVersion:f.version,reason});
      assert.equal(resumed.request.status,"in_progress");f.version=resumed.request.version;
      let revokedCalls=0;
      await assert.rejects(()=>step(f,async()=>{
        revokedCalls++;
        await db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.identityId,f.actor.identityId));
      }),{status:403});
      assert.equal(revokedCalls,1);
      assert.equal((await db.select().from(valoPrivacyErasureObjects).where(eq(valoPrivacyErasureObjects.caseId,f.id))).filter(x=>x.status==="deleted").length,2);
      await db.update(valoStaffAssignments).set({active:true}).where(eq(valoStaffAssignments.identityId,f.actor.identityId));
      await finish(f,async()=>{});
      // Create persisted object progress before replacing only the current signer.
      const initial=await replayErasureObjects(f.id,async()=>{});assert.equal(initial.deleted,10);
      await assertWrongCurrentKey(remove=>replayErasureObjects(f.id,remove),f.id);
      for(let n=0;n<4;n++){const r=await replayErasureObjects(f.id,async()=>{});if(!r.remaining)break;}
      // Simulate restored application rows after importing the retained journal.
      await db.insert(valoDocuments).values(Array.from({length:235},()=>({id:randomUUID(),workspaceId:f.owner.workspaceId})));
      const replayed:string[]=[];let complete=false,totalRows=0;
      for(let n=0;n<40;n++){
        const result=await replayErasedApplication(f.id,async key=>{replayed.push(key);});
        assert.ok(result.deleted<=10);assert.ok(result.applicationRowsRemoved<=100);totalRows+=result.applicationRowsRemoved;
        if(!result.remaining){complete=true;break;}
      }
      assert.equal(complete,true);assert.equal(totalRows,235);
      assert.deepEqual(replayed,keys,"application batches must not restart the completed object phase");
      assert.equal((await db.select().from(valoDocuments).where(eq(valoDocuments.workspaceId,f.owner.workspaceId))).length,0);
    });
    await t.test("actual export worker cleans an upload finishing after its tracking/job rows were erased",async()=>{
      const f=await setup(),job=await exportJob(f),objects=new Map<string,Buffer>();
      let release!:()=>void,accepted!:(key:string)=>void,uploaded=false,lateCleanup=false;
      const barrier=new Promise<void>(r=>{release=r;}),ready=new Promise<string>(r=>{accepted=r;});
      const running=executeExport(job.id,f.owner.workspaceId,job.queueId,undefined,{
        write:async(key,bytes,onUploading)=>{
          await onUploading?.();accepted(key);await barrier;objects.set(key,bytes);uploaded=true;
          return{checksum:createHash("sha256").update(bytes).digest("hex"),size:bytes.length};
        },remove:async key=>{if(uploaded)lateCleanup=true;objects.delete(key);},
      }).then(()=>({ok:true,error:null}),error=>({ok:false,error}));
      const key=await Promise.race([ready,running.then(()=>{throw Error("Export failed before reaching the controlled upload barrier.");})]);
      try{
        await step(f,async object=>{objects.delete(object);});
        let orphanCalls=0;
        const incomplete=await reconcileExportOrphans(job.id,async()=>{orphanCalls++;});
        assert.equal(orphanCalls,0);assert.equal(incomplete.privacyHeld,1);
        await db.update(valoExportObjects).set({nextCleanupAt:new Date(0)}).where(eq(valoExportObjects.jobId,job.id));
        const[before]=await db.select().from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.caseId,f.id));
        try{
          await db.update(valoPrivacyTombstones).set({erasureSeal:{...before.erasureSeal,mac:"0".repeat(64)}})
            .where(eq(valoPrivacyTombstones.caseId,f.id));
          const corrupt=await reconcileExportOrphans(job.id,async()=>{orphanCalls++;});
          assert.equal(orphanCalls,0);assert.equal(corrupt.privacyHeld,1);
        }finally{await db.update(valoPrivacyTombstones).set({erasureSeal:before.erasureSeal}).where(eq(valoPrivacyTombstones.caseId,f.id));}
        await db.update(valoExportObjects).set({nextCleanupAt:new Date(0)}).where(eq(valoExportObjects.jobId,job.id));
        const held=await simpleStaffPrivacyAction(fresh(f),f.id,{action:"hold",expectedVersion:f.version,reason});
        f.version=held.request.version;
        const heldCleanup=await reconcileExportOrphans(job.id,async()=>{orphanCalls++;});
        assert.equal(orphanCalls,0);assert.equal(heldCleanup.privacyHeld,1);
        const released=await simpleStaffPrivacyAction(fresh(f),f.id,{action:"release_hold",expectedVersion:f.version,reason});
        f.version=released.request.version;
        await finish(f,async object=>{objects.delete(object);});
        assert.equal((await db.select().from(valoExportJobs).where(eq(valoExportJobs.id,job.id))).length,0);
        assert.equal((await db.select().from(valoExportObjects).where(eq(valoExportObjects.objectKey,key))).length,0);
      }finally{release();}
      const result=await running;assert.equal(result.ok,false);assert.equal(lateCleanup,false);
      assert.equal(objects.size,1,"privacy-owned cleanup must pass the signed-case gate");
      const cleanup=await reconcileErasedObjects(async key=>{lateCleanup=true;objects.delete(key);},f.id);
      assert.equal(cleanup.cleaned,1);assert.equal(cleanup.held,0);assert.equal(lateCleanup,true);assert.equal(objects.size,0);
      assert.equal((await db.select().from(valoPrivacyErasureObjects).where(eq(valoPrivacyErasureObjects.caseId,f.id))).length,1);
    });
    await t.test("SIGKILL before upload acknowledgement leaves a durable automatic late-write cleanup path",async()=>{
      const f=await setup(),objects=new Map<string,Buffer>();
      const[revision]=await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.id,f.document.revisionId));
      // Isolate the subprocess fixture from the always-on development queued
      // dispatcher. This valid retry state still uses unmodified executeExport;
      // customer queue creation is exercised by the other export tests.
      const job={id:randomUUID(),workspaceId:f.owner.workspaceId,documentId:f.document.id,
        revisionId:revision.id,revision:revision.revision,format:"docx" as const,renderVersion:RENDER_VERSION,
        sourceHash:revision.contentHash,requestedBy:f.owner.identityId,queueId:randomUUID(),status:"retrying" as const};
      await db.insert(valoExportJobs).values(job);
      const child=fork(fileURLToPath(new URL("../scripts/erasure-upload-crash-child.ts",import.meta.url)),
        [job.id,f.owner.workspaceId,job.queueId],{execArgv:["--import","tsx"],
          env:{...process.env,VALO_ERASURE_CRASH_CHILD:"controlled-synthetic-only"},stdio:["ignore","pipe","pipe","ipc"]});
      children.push(child);
      child.stderr?.resume();child.stdout?.resume();
      const accepted=await new Promise<{key:string;bytes:string}>((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error("Controlled upload child did not reach the accepted barrier.")),30000);
        child.once("error",e=>{clearTimeout(timeout);reject(e);});
        child.once("exit",code=>{clearTimeout(timeout);reject(Error("Controlled upload child exited before its barrier; code "+String(code)));});
        child.on("message",raw=>{const m=raw as {stage?:string;key?:string;bytes?:string;errorCode?:string};
          if(m.stage==="worker_returned"){clearTimeout(timeout);reject(Error("Controlled worker returned before upload barrier: "+m.errorCode));}
          if(m.stage==="upload_accepted"&&m.key&&m.bytes){clearTimeout(timeout);resolve({key:m.key,bytes:m.bytes});}});
      });
      await finish(f,async key=>{objects.delete(key);});
      const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGKILL");await exited;
      assert.equal(child.signalCode,"SIGKILL");
      // The controlled object service completes a request accepted before the
      // client process died. No catch/finally in that client can clean it up.
      objects.set(accepted.key,Buffer.from(accepted.bytes,"base64"));
      const result=await reconcileErasedObjects(async key=>{objects.delete(key);},f.id);
      assert.equal(result.held,0);assert.equal(result.failed,0);assert.equal(result.cleaned,1);assert.equal(objects.size,0);
      assert.equal((await db.select().from(valoExportObjects).where(eq(valoExportObjects.workspaceId,f.owner.workspaceId))).length,0);
    });
  }finally{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");
    if(owners.length){
      // Removing fixture tombstones first is required by the inventory guard.
      for(const table of[valoPrivacyTombstones,valoPrivacyErasureObjects,valoPrivacyEvents,valoPrivacyCases,
        valoExportRequests,valoFileAssets,valoExportObjects,valoExportJobs,valoSupportTickets,valoEvents,
        valoDocumentRevisions,valoDocuments,valoProfileVersions,valoMemberships])
        await db.delete(table).where(inArray(table.workspaceId,owners));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id,owners));
    }
    if(operators.length){
      await db.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId,operators));
      await db.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId,operators));
    }
    await closePrivacyErasureLocks();
    await pool.end();
  }
});
