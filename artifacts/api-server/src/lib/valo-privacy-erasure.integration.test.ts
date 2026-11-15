import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db,pool,valoPrivacyErasureObjects,valoPrivacyCases,valoPrivacyEvents,valoPrivacyTombstones,
  valoWorkspaces,valoMemberships,valoStaffAssignments,valoStaffAccessAudit,valoProfileVersions,
  valoDocuments,valoDocumentRevisions,valoSupportTickets,valoEvents,valoAIDrafts,
  valoExportJobs,valoFileAssets,valoExportObjects,valoPrivacyMessages} from "@workspace/db";
import {eq,inArray,sql} from "drizzle-orm";
import {resolveWorkspace,saveProfile,createDocument,authorizeWorkspaceWrite} from "./valo-store";
import {syntheticProfile,syntheticDocument} from "./valo-test-fixtures";
import {createPrivacyCase,confirmPrivacyCase,simpleStaffPrivacyAction,readPrivacyCase,privacyChange} from "./valo-privacy";
import {processPrivacyErasure,replayErasureObjects,replayErasedApplication,closePrivacyErasureLocks} from "./valo-privacy-erasure";
import {writePrivateFile,readPrivateFile,deletePrivateFile} from "./valo-private-storage";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
import {signErasureSeal,type ErasureSeal} from "./valo-erasure-seal";
import {privacySigner} from "./valo-privacy-keys";
import {executeExport} from "./valo-exports";

test("resumable physical development erasure with retained exclusions and replay",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",timeout:60000,
},async t=>{
  assertDevelopmentRuntime();
  const run=randomUUID(),a=await resolveWorkspace(`synthetic-erasure-${run}`),
    b=await resolveWorkspace(`synthetic-erasure-other-${run}`);
  const staff={identityId:`synthetic-privacy-${run}`,recentMfa:true,verifiedAt:Date.now()};
  let id="",version=0;
  let preparedCaseId="";
  let storageKey="";
  const privateObjects:{key:string;checksum:string;jobId:string;queueId:string}[]=[];
  const reason="Controlled synthetic application erasure, retaining financial and external exclusions.";
  try{
    await db.insert(valoStaffAssignments).values({id:randomUUID(),identityId:staff.identityId,role:"privacy",
      grantedBy:"synthetic-test-only",reason});
    await saveProfile(a,{expectedRevision:0,profile:syntheticProfile});
    await createDocument(a,syntheticDocument);
    await createDocument(b,syntheticDocument);
    const[revision]=await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.workspaceId,a.workspaceId));
    for(const state of["retained","pending","cleanup"] as const){
      const key=`valo/development/${a.workspaceId}/${randomUUID()}.pdf`,jobId=randomUUID(),queueId=randomUUID();
      const bytes=Buffer.from(`Synthetic ${state} erasure bytes; not a PDF-rendering test.`);
      const stored=(state==="pending"||!process.env.PRIVATE_OBJECT_DIR)?{checksum:"0".repeat(64)}:await writePrivateFile(key,bytes);
      privateObjects.push({key,checksum:stored.checksum,jobId,queueId});
      await db.insert(valoExportJobs).values({id:jobId,workspaceId:a.workspaceId,documentId:revision.documentId,
        revisionId:revision.id,revision:revision.revision,format:"pdf",renderVersion:`erasure-${state}`,
        sourceHash:revision.contentHash,requestedBy:a.identityId,queueId,status:state==="retained"?"ready":"running"});
      await db.execute(sql`INSERT INTO valo_jobs.job(id,name,data,start_after)
        VALUES(${queueId}::uuid,'valo-manual-export-v1',
          ${JSON.stringify({workspaceId:a.workspaceId,jobId,privateMarker:"SYNTHETIC-QUEUED-COPY"})}::jsonb,
          now()+interval '1 hour')`);
      await db.insert(valoExportObjects).values({objectKey:key,workspaceId:a.workspaceId,jobId,queueId,state});
      if(state==="retained")await db.insert(valoFileAssets).values({id:randomUUID(),workspaceId:a.workspaceId,
        jobId,objectKey:key,checksum:stored.checksum,size:bytes.length,mime:"application/pdf"});
    }
    await db.insert(valoAIDrafts).values({id:randomUUID(),workspaceId:a.workspaceId,actorId:a.identityId,
      idempotencyKey:randomUUID(),inputHash:"a".repeat(64),task:"invoice",status:"preview",promptVersion:"controlled",
      preview:{privateMarker:"ERASE-ME"},plan:{privateMarker:"ERASE-ME"},providerCalls:1,budgetReserved:true,
      providerRuns:[{responseId:"synthetic-no-real-provider-call",usage:{inputTokens:10,outputTokens:10}}]});
    const prepared=await createPrivacyCase(a,"synthetic-private-contact@example.invalid",{kind:"export",
      idempotencyKey:randomUUID(),message:"SYNTHETIC-PRIVATE-REQUEST-TEXT",acknowledgement:true});
    preparedCaseId=prepared.reference.slice(5);
    await db.insert(valoPrivacyMessages).values({id:randomUUID(),workspaceId:a.workspaceId,caseId:preparedCaseId,
      replyToVersion:1,body:"SYNTHETIC-ERASE-PRIVATE-CASE-REPLY"});
    await db.transaction(async tx=>{
      const existing=await readPrivacyCase(tx,preparedCaseId);
      await privacyChange(tx,existing,{identityId:"synthetic-fixture-setup",type:"worker"},"synthetic_result_fixture",
        "Controlled prepared-data fixture, not actual fulfilment.",{resultJson:{privateMarker:"SYNTHETIC-PREPARED-RESULT"}});
    });
    const request=await createPrivacyCase(a,"synthetic@example.invalid",{kind:"deletion",idempotencyKey:randomUUID(),message:reason,acknowledgement:true});
    id=request.reference.slice(5);
    let detail=await confirmPrivacyCase(a,id,{expectedVersion:1,acknowledgement:true});
    detail=await simpleStaffPrivacyAction(staff,id,{expectedVersion:detail.request.version,action:"claim",reason});
    version=detail.request.version;
    const key=`valo/development/${a.workspaceId}/${randomUUID()}.pdf`;
    // Controlled fixture captured before sealing; production capture reads the
    // actual export reservation/file rows in the same quarantine transaction.
    await db.insert(valoPrivacyErasureObjects).values({workspaceId:a.workspaceId,caseId:id,objectKey:key});
    const act=(action:"start_erasure"|"resume_erasure",acknowledgement=true)=>
      processPrivacyErasure({...staff,verifiedAt:Date.now()},id,{expectedVersion:version,action,reason,acknowledgement});
    await t.test("unacknowledged, wrong-role and stale requests cannot delete content",async()=>{
      await assert.rejects(()=>act("start_erasure",false),{status:422});
      await assert.rejects(()=>processPrivacyErasure({...staff,recentMfa:false},id,
        {expectedVersion:version,action:"start_erasure",reason,acknowledgement:true}),{status:403});
      await assert.rejects(()=>processPrivacyErasure(staff,id,
        {expectedVersion:0,action:"start_erasure",reason,acknowledgement:true}),{status:409});
      assert.equal((await db.select().from(valoDocuments).where(eq(valoDocuments.workspaceId,a.workspaceId))).length,1);
    });
    await t.test("quarantine persists before physical deletion and denies workspace resurrection",async()=>{
      const raced=await Promise.allSettled([act("start_erasure"),act("start_erasure")]);
      assert.equal(raced.filter(r=>r.status==="fulfilled").length,1);
      detail=(raced.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<typeof detail>).value;
      version=detail.request.version;
      assert.equal(detail.request.status,"in_progress");
      assert.equal((await db.select().from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.caseId,id))).length,1);
      await assert.rejects(()=>resolveWorkspace(a.identityId),{status:403});
      assert.equal((await db.select().from(valoDocuments).where(eq(valoDocuments.workspaceId,a.workspaceId))).length,1);
    });
    await t.test("object failure is retained and blocks content purge; repeated deletion is retryable",async()=>{
      const queued=await db.execute(sql`SELECT count(*)::int AS count FROM valo_jobs.job
        WHERE data->>'workspaceId'=${a.workspaceId}`);
      assert.equal(queued.rows[0]!.count,0,"scoped queued private payloads survived the access fence");
      let calls=0;
      await assert.rejects(()=>replayErasureObjects(id,async()=>{calls++;}),{status:409});
      assert.equal(calls,0,"unfinished cases never dispatch recovery deletes");
      detail=await processPrivacyErasure({...staff,verifiedAt:Date.now()},id,
        {expectedVersion:version,action:"resume_erasure",reason,acknowledgement:true},async()=>{throw Error("controlled storage outage");});
      version=detail.request.version;
      assert.equal((await db.select().from(valoPrivacyErasureObjects).where(eq(valoPrivacyErasureObjects.caseId,id)))[0].status,"failed");
      assert.equal((await db.select().from(valoDocuments).where(eq(valoDocuments.workspaceId,a.workspaceId))).length,1);
      detail=await processPrivacyErasure({...staff,verifiedAt:Date.now()},id,
        {expectedVersion:version,action:"resume_erasure",reason,acknowledgement:true},async received=>{
          assert.ok([key,...privateObjects.map(o=>o.key)].includes(received));
          if(process.env.PRIVATE_OBJECT_DIR)await deletePrivateFile(received);
        });
      version=detail.request.version;
    });
    await t.test("ready, pending and cleanup objects are inventoried once before rows disappear and stale workers stay fenced",async()=>{
      const inventory=await db.select().from(valoPrivacyErasureObjects).where(eq(valoPrivacyErasureObjects.caseId,id));
      assert.equal(inventory.length,4);
      assert.equal(new Set(inventory.map(x=>x.objectKey)).size,4);
      assert.ok(inventory.every(x=>x.status==="deleted"));
      for(const object of privateObjects){
        const[job]=await db.select().from(valoExportJobs).where(eq(valoExportJobs.id,object.jobId));
        assert.equal(job.status,"failed");assert.notEqual(job.queueId,object.queueId);
        await executeExport(object.jobId,a.workspaceId,object.queueId);
        if(process.env.PRIVATE_OBJECT_DIR)await assert.rejects(()=>readPrivateFile(object.key,object.checksum),/PRIVATE_STORAGE_READ_FAILED/);
      }
    });
    await t.test("resume physically removes only scoped rows, keeping explicit unfulfilled records and another tenant",async()=>{
      for(let n=0;n<60&&detail.request.status!=="partially_fulfilled";n++){
        detail=await act("resume_erasure");version=detail.request.version;
      }
      assert.equal(detail.request.status,"partially_fulfilled");
      for(const table of[valoDocuments,valoDocumentRevisions,valoProfileVersions])
        assert.equal((await db.select().from(table).where(eq(table.workspaceId,a.workspaceId))).length,0);
      assert.equal((await db.select().from(valoDocuments).where(eq(valoDocuments.workspaceId,b.workspaceId))).length,1);
      assert.ok((await db.select().from(valoSupportTickets).where(eq(valoSupportTickets.workspaceId,a.workspaceId))).length>0);
      assert.ok(detail.steps.some(s=>s.system==="external_processors"&&s.status==="held"));
      assert.match(detail.request.resultScope,/not complete account deletion/);
      const[usage]=await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.workspaceId,a.workspaceId));
      assert.equal(usage.providerCalls,1);assert.equal(usage.budgetReserved,true);
      assert.deepEqual(usage.preview,{});assert.equal(usage.plan,null);
      const support=await db.select().from(valoSupportTickets).where(eq(valoSupportTickets.workspaceId,a.workspaceId));
      assert.ok(support.every(row=>row.scope==="[Private content removed by verified workspace erasure]"&&row.contactEmail==="erased@invalid"));
      await db.transaction(async tx=>{
        for(const caseId of[id,preparedCaseId]){
          const checked=await readPrivacyCase(tx,caseId);
          assert.equal(checked.message,"[Private content removed by verified workspace erasure]");
          assert.equal(checked.resultJson,null);
        }
      });
      assert.equal((await db.select().from(valoPrivacyMessages).where(eq(valoPrivacyMessages.workspaceId,a.workspaceId))).length,0);
      assert.equal(usage.providerRuns.length,1);
    });
    await t.test("restored membership and late-written objects are re-deleted from retained tombstones",async()=>{
      await db.update(valoMemberships).set({active:"yes"}).where(eq(valoMemberships.workspaceId,a.workspaceId));
      await assert.rejects(()=>db.transaction(tx=>authorizeWorkspaceWrite(tx,a)),{status:403});
      await db.insert(valoDocuments).values({id:randomUUID(),workspaceId:a.workspaceId});
      const removed:string[]=[];
      const replay=await replayErasureObjects(id,async key=>{removed.push(key);});
      assert.equal(replay.deleted,4);
      assert.deepEqual(new Set(removed),new Set([key,...privateObjects.map(o=>o.key)]));
      await assert.rejects(()=>resolveWorkspace(a.identityId),{status:403});
      assert.equal((await replayErasureObjects(id,async()=>{})).deleted,4);
      let physical=await replayErasedApplication(id,async()=>{});
      for(let n=0;n<25&&physical.remaining;n++)physical=await replayErasedApplication(id,async()=>{});
      assert.equal(physical.remaining,false);
      assert.equal((await db.select().from(valoDocuments).where(eq(valoDocuments.workspaceId,a.workspaceId))).length,0);
    });
    await t.test("native private storage deletion and repeated late-write replay remove actual synthetic bytes",{
      skip:!process.env.PRIVATE_OBJECT_DIR?"Native Replit storage is unavailable here; portable database controls still run.":false,
    },async()=>{
      storageKey=key;
      const stored=await writePrivateFile(key,Buffer.from("Synthetic erasure storage probe; not a document-format test."));
      assert.ok((await readPrivateFile(key,stored.checksum)).length>0);
      const replay=await replayErasureObjects(id);
      assert.equal(replay.failed,0);assert.equal(replay.deleted,4);
      await assert.rejects(()=>readPrivateFile(key,stored.checksum),/PRIVATE_STORAGE_READ_FAILED/);
      assert.equal((await replayErasureObjects(id)).failed,0);
    });
    await t.test("sealed key tampering and corrupted completion proof stop before deletion",async()=>{
      const hostile=`valo/development/${b.workspaceId}/${randomUUID()}.pdf`;
      const rejected=(e:unknown)=>(e as {cause?:{code?:string};code?:string}).cause?.code==="23514"||(e as {code?:string}).code==="23514";
      await assert.rejects(()=>db.insert(valoPrivacyErasureObjects).values({workspaceId:a.workspaceId,caseId:id,objectKey:hostile}),rejected);
      const sameWorkspace=`valo/development/${a.workspaceId}/${randomUUID()}.pdf`;
      await assert.rejects(()=>db.update(valoPrivacyErasureObjects).set({objectKey:sameWorkspace})
        .where(eq(valoPrivacyErasureObjects.caseId,id)),rejected);
      const[original]=await db.select().from(valoPrivacyTombstones).where(eq(valoPrivacyTombstones.caseId,id));
      await assert.rejects(()=>db.update(valoPrivacyTombstones).set({erasureSeal:null})
        .where(eq(valoPrivacyTombstones.caseId,id)),rejected);
      const calls:string[]=[];
      try{
        await db.update(valoPrivacyTombstones).set({erasureSeal:{...original.erasureSeal,mac:"b".repeat(64)}})
          .where(eq(valoPrivacyTombstones.caseId,id));
        await assert.rejects(()=>replayErasureObjects(id,async key=>{calls.push(key);}),/ERASURE_SEAL_INVALID/);
        assert.equal(calls.length,0);
      }finally{await db.update(valoPrivacyTombstones).set({erasureSeal:original.erasureSeal}).where(eq(valoPrivacyTombstones.caseId,id));}
      const[receipt]=await db.select().from(valoPrivacyEvents).where(eq(valoPrivacyEvents.caseId,id)).limit(1);
      try{
        await db.update(valoPrivacyEvents).set({reason:"controlled unsigned corruption"}).where(eq(valoPrivacyEvents.id,receipt.id));
        await assert.rejects(()=>replayErasureObjects(id,async key=>{calls.push(key);}));assert.equal(calls.length,0);
      }finally{await db.update(valoPrivacyEvents).set({reason:receipt.reason}).where(eq(valoPrivacyEvents.id,receipt.id));}
      try{
        const absentReceipt=await db.transaction(async tx=>signErasureSeal({...(original.erasureSeal as ErasureSeal),
          completedEventHash:"f".repeat(64)},await privacySigner(tx)));
        await db.update(valoPrivacyTombstones).set({erasureSeal:absentReceipt}).where(eq(valoPrivacyTombstones.caseId,id));
        await assert.rejects(()=>replayErasureObjects(id,async key=>{calls.push(key);}),{status:409});assert.equal(calls.length,0);
      }finally{await db.update(valoPrivacyTombstones).set({erasureSeal:original.erasureSeal}).where(eq(valoPrivacyTombstones.caseId,id));}
    });
    await t.test("non-development and every nonempty deployment marker stop before deletion I/O",async()=>{
      const oldNode=process.env.NODE_ENV,oldDeployment=process.env.REPLIT_DEPLOYMENT;
      let calls=0;
      try{
        for(const mode of["production","test",undefined]){
          if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode;
          await assert.rejects(()=>replayErasureObjects(id,async()=>{calls++;}),{code:"DEVELOPMENT_RUNTIME_REQUIRED"});
        }
        process.env.NODE_ENV="development";
        for(const marker of["1","true","arbitrary","false"," "]){
          process.env.REPLIT_DEPLOYMENT=marker;
          await assert.rejects(()=>replayErasureObjects(id,async()=>{calls++;}),{code:"DEVELOPMENT_RUNTIME_REQUIRED"});
        }
        assert.equal(calls,0);
      }finally{
        if(oldNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNode;
        if(oldDeployment===undefined)delete process.env.REPLIT_DEPLOYMENT;else process.env.REPLIT_DEPLOYMENT=oldDeployment;
      }
    });
    await t.test("even a deleted membership cannot recreate an identity with a deletion tombstone",async()=>{
      await db.delete(valoMemberships).where(eq(valoMemberships.workspaceId,a.workspaceId));
      // Simulate no remaining ownership mapping; the post-cutoff identity
      // journal must stop creation of a different workspace UUID as well.
      await db.update(valoWorkspaces).set({ownerIdentityId:`synthetic-anonymised-${randomUUID()}`})
        .where(eq(valoWorkspaces.id,a.workspaceId));
      await assert.rejects(()=>resolveWorkspace(a.identityId),{status:403});
      assert.equal((await db.select().from(valoMemberships).where(eq(valoMemberships.workspaceId,a.workspaceId))).length,0);
    });
  }finally{
    for(const object of privateObjects)await deletePrivateFile(object.key).catch(()=>{});
    for(const table of[valoFileAssets,valoExportObjects,valoExportJobs])
      await db.delete(table).where(eq(table.workspaceId,a.workspaceId));
    if(storageKey)await deletePrivateFile(storageKey);
    const ids=[a.workspaceId,b.workspaceId];
    for(const table of[valoPrivacyMessages,valoPrivacyTombstones,valoPrivacyErasureObjects,valoPrivacyEvents,valoPrivacyCases,
      valoSupportTickets,valoEvents,valoAIDrafts,valoDocumentRevisions,valoDocuments,valoProfileVersions,valoMemberships])
      await db.delete(table).where(inArray(table.workspaceId,ids));
    await db.delete(valoStaffAccessAudit).where(eq(valoStaffAccessAudit.actorId,staff.identityId));
    await db.delete(valoStaffAssignments).where(eq(valoStaffAssignments.identityId,staff.identityId));
    await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id,ids));
    await closePrivacyErasureLocks();
    await pool.end();
  }
});
