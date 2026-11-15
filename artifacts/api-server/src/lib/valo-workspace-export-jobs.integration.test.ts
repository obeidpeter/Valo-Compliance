import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {stat} from "node:fs/promises";
import {eq,and,inArray} from "drizzle-orm";
import express from "express";
import {db,pool,valoEvents,valoMemberships,valoWorkspaceExports as jobs,valoWorkspaceExportAttempts as attempts} from "@workspace/db";
import {makeWorkspaceExportRouter} from "./valo-workspace-export-http";
import {resolveWorkspace,ValoProblem} from "./valo-store";
import {assertWorkspaceDownloadSession} from "./valo-download-session";
import {workspaceExportScratch,cleanupWorkspaceExports} from "./valo-workspace-export-jobs";
import {workspaceExportStorage} from "./valo-workspace-export-storage";
import {anonymousPrivateFileStatus} from "./valo-private-storage";
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{resolve,promise};};
const timeout=<T>(p:Promise<T>,ms=3000)=>Promise.race([p,new Promise<never>((_r,j)=>{const t=setTimeout(()=>j(Error("CONTROLLED_WAIT_TIMEOUT")),ms);t.unref();})]);
test("durable workspace export: native HTTP cancellation, live authorization, private App Storage and process restart",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",timeout:120000,
},async t=>{
  assert.equal(process.env.NODE_ENV,"development");assert.ok(!process.env.REPLIT_DEPLOYMENT);
  const a=await resolveWorkspace("synthetic-workspace-export-a-"+randomUUID()),b=await resolveWorkspace("synthetic-workspace-export-b-"+randomUUID());
  const marker="OWNED_SYNTHETIC_EXPORT_"+randomUUID();let access="active",pause=false,seen=deferred(),release=deferred(),pageCount=0;
  const expectedEvents=Array.from({length:5001},(_,i)=>({id:randomUUID(),workspaceId:a.workspaceId,
    actorId:a.identityId,entityId:a.workspaceId,action:marker+"_"+i+"_"+"x".repeat(2000)}));
  const lateEvent={id:randomUUID(),workspaceId:a.workspaceId,actorId:a.identityId,entityId:a.workspaceId,action:"NEW_DATED_COPY_ONLY"};
  let mutateSnapshot=false;
  const startedAt=new Date().toISOString(),measurements:Record<string,unknown>[]=[];let storageCalls=0;
  const observedStorage:typeof workspaceExportStorage={
    put:async(...args)=>{storageCalls++;return workspaceExportStorage.put(...args);},
    get:async(...args)=>{storageCalls++;return workspaceExportStorage.get(...args);},
    remove:async(...args)=>{storageCalls++;return workspaceExportStorage.remove(...args);},
  };
  const router=makeWorkspaceExportRouter(async(_req,actor)=>assertWorkspaceDownloadSession(actor,{userId:actor.identityId,sessionId:"controlled-original-session"},{
    session:async()=>({status:access==="revoked"?"revoked":"active",userId:actor.identityId}),
    user:async()=>({id:actor.identityId,banned:access==="suspended",locked:false,primaryEmailAddressId:"primary",
      emailAddresses:[{id:"primary",verification:{status:"verified"}}]}),
  }),async(section,rows)=>{
    if(section==="yourActivity"){pageCount++;
      if(mutateSnapshot&&rows===500){mutateSnapshot=false;await db.insert(valoEvents).values(lateEvent);}
      if(pause&&rows===500){seen.resolve();await release.promise;}
    }
  },observedStorage);
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{const actor=req.headers.cookie==="synthetic=B"?b:req.headers.cookie==="synthetic=A"?a:null;
    if(!actor){res.status(401).json({error:"Controlled sign-in required"});return;}
    res.locals.valoActor=actor;next();});
  app.use(router);
  app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    if(res.headersSent){res.destroy();return;}
    res.status(err instanceof ValoProblem?err.status:503).json({error:err instanceof ValoProblem?err.message:"Preparation unavailable"});
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const base="http://127.0.0.1:"+(server.address() as {port:number}).port,old=process.env.VALO_TRUSTED_ORIGIN;
  process.env.VALO_TRUSTED_ORIGIN=base;
  const request=(path:string,init:RequestInit={},who="A")=>fetch(base+"/workspace/data-exports"+path,{
    ...init,headers:{Cookie:"synthetic="+who,Origin:base,"Content-Type":"application/json",...init.headers}});
  const create=async()=>{const r=await request("",{method:"POST",body:JSON.stringify({requestKey:randomUUID()})});assert.equal(r.status,201);return(await r.json() as {id:string}).id;};
  const row=async(id:string)=>(await db.select().from(jobs).where(eq(jobs.id,id)))[0]!;
  const reset=()=>{access="active";pause=true;seen=deferred();release=deferred();pageCount=0;};
  async function interrupted(id:string){
    const end=Date.now()+2500;
    while((await row(id)).status==="preparing"&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
    assert.equal((await row(id)).status,"interrupted");
    await assert.rejects(stat(workspaceExportScratch((await row(id)).currentAttemptId!)),{code:"ENOENT"});
  }
  try{
    await t.test("non-development modes and every nonempty deployment marker reject HTTP creation without jobs or storage",async()=>{
      const before=(await db.select().from(jobs).where(eq(jobs.workspaceId,a.workspaceId))).length,io=storageCalls;
      const node=process.env.NODE_ENV,deployed=process.env.REPLIT_DEPLOYMENT;
      try{
        for(const mode of [undefined,"production","staging"]){
          if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode;
          const r=await request("",{method:"POST",body:JSON.stringify({requestKey:randomUUID()})});assert.equal(r.status,503);
        }
        process.env.NODE_ENV="development";
        for(const marker of ["1","true","arbitrary-nonempty"]){
          process.env.REPLIT_DEPLOYMENT=marker;
          const r=await request("",{method:"POST",body:JSON.stringify({requestKey:randomUUID()})});assert.equal(r.status,503);
        }
      }finally{
        if(node===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=node;
        if(deployed===undefined)delete process.env.REPLIT_DEPLOYMENT;else process.env.REPLIT_DEPLOYMENT=deployed;
      }
      assert.equal((await db.select().from(jobs).where(eq(jobs.workspaceId,a.workspaceId))).length,before);
      assert.equal(storageCalls,io);
    });
    await db.insert(valoEvents).values(expectedEvents);
    await db.insert(valoEvents).values({id:randomUUID(),workspaceId:b.workspaceId,actorId:b.identityId,entityId:b.workspaceId,action:"OTHER_TENANT_PRIVATE_MARKER"});
    await t.test("actual HTTP disconnect mid-page stops preparation promptly and same durable job can restart",async()=>{
      reset();const id=await create(),abort=new AbortController(),response=request("/"+id+"/download",{signal:abort.signal});
      void response.catch(()=>{});await timeout(seen.promise,10000);
      const start=Date.now(),before=pageCount;abort.abort();await assert.rejects(response);await interrupted(id);
      assert.ok(Date.now()-start<2500);assert.equal(pageCount,before);
      measurements.push({boundary:"disconnect",elapsedMs:Date.now()-start,activityRowsAtStop:500,scratchRemoved:true});
      release.resolve();pause=false;mutateSnapshot=true;
      const retry=await request("/"+id+"/download");assert.equal(retry.status,200);
      const text=await retry.text();assert.ok(Buffer.byteLength(text)>8_000_000);
      const data=JSON.parse(text);assert.equal(data.complete,true);assert.equal(data.data.yourActivity.length,5001);
      assert.equal(new Set(data.data.yourActivity.map((r:{id:string})=>r.id)).size,5001);
      assert.deepEqual(data.data.yourActivity.map((r:{id:string})=>r.id).sort(),expectedEvents.map(r=>r.id).sort(),
        "exact snapshot IDs, including exclusion of a row inserted during pagination");
      assert.equal(data.counts.yourActivity,5001);assert.ok(!text.includes("OTHER_TENANT_PRIVATE_MARKER"));
      const result=await row(id);assert.equal(result.attempts,2);assert.equal(result.status,"ready");
      measurements.push({boundary:"complete native private result",bytes:Buffer.byteLength(text),sourceRows:5001,
        checksum:result.checksum,snapshotAt:result.snapshotAt?.toISOString()});
      const[audit]=await db.select().from(attempts).where(eq(attempts.id,result.currentAttemptId!));
      assert.ok([403,404].includes(await anonymousPrivateFileStatus(audit!.objectKey)));
      const other=await request("/"+id+"/download",{},"B");assert.equal(other.status,404);assert.equal(other.headers.get("Content-Disposition"),null);
      const range=await request("/"+id+"/download",{headers:{Range:"bytes=0-99","If-Range":retry.headers.get("ETag")!}});
      assert.equal(range.status,206);assert.equal(await range.text(),text.slice(0,100));
      assert.equal((await row(id)).attempts,2,"ready artifact reused instead of rebuilding");
      await request("/"+id+"/cancel",{method:"POST"});
    });
    for(const blocked of ["membership","revoked","suspended"]){
      await t.test(`${blocked} during real HTTP preparation prevents any completed attachment`,async()=>{
        reset();const id=await create(),response=request("/"+id+"/download");await timeout(seen.promise,10000);
        if(blocked==="membership"){
          const start=Date.now();
          await timeout(db.update(valoMemberships).set({active:"no"}).where(and(eq(valoMemberships.workspaceId,a.workspaceId),eq(valoMemberships.identityId,a.identityId))).then(()=>{}),1000);
          assert.ok(Date.now()-start<1000,"membership change did not wait for source snapshot");
          measurements.push({boundary:"membership revocation commit",elapsedMs:Date.now()-start});
        }else access=blocked;
        release.resolve();const result=await response;assert.equal(result.status,blocked==="revoked"?401:403);
        assert.equal(result.headers.get("Content-Disposition"),null);assert.ok(!(await result.text()).includes(marker));
        await interrupted(id);
        access="active";await db.update(valoMemberships).set({active:"yes"}).where(eq(valoMemberships.workspaceId,a.workspaceId));
        await request("/"+id+"/cancel",{method:"POST"});
      });
    }
    await t.test("actual SIGKILL leaves a fenced attempt; a restarted preparer creates one complete new snapshot",async()=>{
      reset();pause=false;const id=await create();
      const child=spawn(process.execPath,["--import","tsx","src/scripts/workspace-export-interruption-child.ts",id,a.workspaceId,a.identityId],{
        cwd:process.cwd(),env:{...process.env,NODE_ENV:"development"},stdio:["ignore","ignore","pipe","ipc"]});
      const failed=once(child,"exit").then(()=>{throw Error("CHILD_EXITED_BEFORE_PAGE");});
      const ready=await timeout(Promise.race([once(child,"message"),failed]),12000);assert.equal((ready[0] as {stage:string}).stage,"page");
      const exit=once(child,"exit");child.kill("SIGKILL");const[,signal]=await exit;assert.equal(signal,"SIGKILL");
      assert.equal((await row(id)).status,"preparing");
      // Controlled clock advance of this owned fixture, not an elapsed-time claim.
      await db.update(jobs).set({leaseUntil:new Date(0)}).where(eq(jobs.id,id));
      await cleanupWorkspaceExports(workspaceExportStorage,a.workspaceId);
      const response=await request("/"+id+"/download");assert.equal(response.status,200);
      const data=await response.json() as {complete:boolean;counts:{yourActivity:number}};
      assert.equal(data.complete,true);assert.equal(data.counts.yourActivity,5002);assert.equal((await row(id)).attempts,2);
      assert.deepEqual((data as unknown as {data:{yourActivity:{id:string}[]}}).data.yourActivity.map(r=>r.id).sort(),
        [...expectedEvents.map(r=>r.id),lateEvent.id].sort(),"restarted whole snapshot includes the exactly identified later row");
      await request("/"+id+"/cancel",{method:"POST"});
    });
    console.log(JSON.stringify({startedAt,finishedAt:new Date().toISOString(),measurements,realNativePrivateStorage:true,sourceRows:5001,minimumBytes:8000000,
      actualHttpDisconnect:true,realProcessSigkill:true,leaseExpiry:"owned fixture clock advanced",realManagedProviderSession:false,
      controlledIdentityReader:true,externalMessages:0,inferenceCalls:0,productionProof:false}));
  }finally{
    release.resolve();await db.update(valoMemberships).set({active:"yes"}).where(eq(valoMemberships.workspaceId,a.workspaceId));
    const ownAttempts=await db.select().from(attempts).where(eq(attempts.workspaceId,a.workspaceId));
    for(const x of ownAttempts){await workspaceExportStorage.remove(x.objectKey);await import("node:fs/promises").then(fs=>fs.rm(workspaceExportScratch(x.id),{force:true,recursive:true}));}
    await db.delete(attempts).where(eq(attempts.workspaceId,a.workspaceId));await db.delete(jobs).where(eq(jobs.workspaceId,a.workspaceId));
    await db.delete(valoEvents).where(inArray(valoEvents.workspaceId,[a.workspaceId,b.workspaceId]));
    if(old===undefined)delete process.env.VALO_TRUSTED_ORIGIN;else process.env.VALO_TRUSTED_ORIGIN=old;
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();
  }
});
