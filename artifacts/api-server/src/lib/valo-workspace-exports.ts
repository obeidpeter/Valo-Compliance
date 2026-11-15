import {randomUUID} from "node:crypto";
import {mkdtemp,open,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {and,eq,desc,lt,lte,inArray,sql} from "drizzle-orm";
import {db,valoWorkspaceExports as jobs,valoWorkspaces,valoFileAssets,valoExportObjects,valoPrivacyTombstones} from "@workspace/db";
import {RequestWorkspaceDataExportBody,CancelWorkspaceDataExportBody} from "@workspace/api-zod";
import {authorizeWorkspaceWrite,type WorkspaceActor,ValoProblem} from "./valo-store";
import {workspaceDataExport} from "./valo-customer-access";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
import {nativeWorkspaceExportStorage,WORKSPACE_EXPORT_MAX_BYTES,WORKSPACE_EXPORT_ATTEMPT_MS,type WorkspaceExportStorage} from "./valo-private-data-storage";

export const WORKSPACE_EXPORT_QUEUE="valo-workspace-data-v1";
export const WORKSPACE_EXPORT_LEASE_MS=90_000;
export const WORKSPACE_EXPORT_SCOPE="Named application sections only. Includes your workspace records and file metadata, not private file bytes, managed identity records, full staff audits or external-provider records. This is not complete privacy fulfilment; use a coordinated privacy request for excluded systems.";
const active=["queued","running","retrying"] as const;
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Job=typeof jobs.$inferSelect;
const owned=(actor:WorkspaceActor,id?:string)=>and(eq(jobs.workspaceId,actor.workspaceId),eq(jobs.requestedBy,actor.identityId),id?eq(jobs.id,id):undefined);
export function workspaceExportView(row:Job){
  const expired=row.status==="ready"&&(!row.expiresAt||row.expiresAt.getTime()<=Date.now());
  const status=expired?"expired":row.status;
  return{id:row.id,status,version:row.version,schemaVersion:2 as const,attempts:row.attempts,retryCycles:row.retryCycles,
    rowsProcessed:row.rowsProcessed,bytesPrepared:row.bytesPrepared,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),
    expiresAt:row.expiresAt?.toISOString()??null,errorCode:row.errorCode,
    downloadUrl:status==="ready"?`/api/workspace/data-exports/${row.id}/file`:null,scope:WORKSPACE_EXPORT_SCOPE,
    mayCancel:[...active,"ready"].includes(status),mayRetry:status==="failed"&&row.retryCycles<2};
}
async function readOwned(tx:Tx,actor:WorkspaceActor,id:string){
  const[row]=await tx.select().from(jobs).where(owned(actor,id)).for("update");
  if(!row)throw new ValoProblem(404,"Workspace export not found.");
  await authorizeWorkspaceWrite(tx,actor);return row;
}
export async function requestWorkspaceExport(actor:WorkspaceActor,raw:unknown){
  assertDevelopmentRuntime();const input=RequestWorkspaceDataExportBody.strict().parse(raw);
  return db.transaction(async tx=>{
    await tx.select({id:valoWorkspaces.id}).from(valoWorkspaces).where(eq(valoWorkspaces.id,actor.workspaceId)).for("update");
    await authorizeWorkspaceWrite(tx,actor);
    const[prior]=await tx.select().from(jobs).where(and(owned(actor),eq(jobs.idempotencyKey,input.idempotencyKey))).limit(1);
    if(prior)return workspaceExportView(prior);
    const[pending]=await tx.select().from(jobs).where(and(owned(actor),inArray(jobs.status,[...active]))).limit(1);
    if(pending)throw new ValoProblem(409,"An export is already being prepared. Reload its recorded progress.");
    const recent=await tx.select({id:jobs.id}).from(jobs).where(and(owned(actor),sql`${jobs.createdAt}>now()-interval '24 hours'`)).limit(10);
    if(recent.length>=10)throw new ValoProblem(429,"The daily export request limit has been reached. Existing exports remain available until their displayed expiry.");
    const[row]=await tx.insert(jobs).values({id:randomUUID(),workspaceId:actor.workspaceId,requestedBy:actor.identityId,
      idempotencyKey:input.idempotencyKey,queueId:randomUUID()}).returning();
    return workspaceExportView(row!);
  });
}
export async function listWorkspaceExports(actor:WorkspaceActor,cursor?:string){
  assertDevelopmentRuntime();return db.transaction(async tx=>{
    await authorizeWorkspaceWrite(tx,actor);
    // UUID order provides an immutable, bounded cursor; the UI shows creation dates.
    const rows=await tx.select().from(jobs).where(and(owned(actor),cursor?lt(jobs.id,cursor):undefined)).orderBy(desc(jobs.id)).limit(26);
    return{items:rows.slice(0,25).map(workspaceExportView),nextCursor:rows.length>25?rows[24]!.id:null};
  });
}
export async function getWorkspaceExport(actor:WorkspaceActor,id:string){
  assertDevelopmentRuntime();return db.transaction(async tx=>workspaceExportView(await readOwned(tx,actor,id)));
}
async function withdraw(tx:Tx,row:Job,status:"cancelled"|"expired"){
  await tx.update(valoFileAssets).set({withdrawnAt:new Date()}).where(eq(valoFileAssets.workspaceExportJobId,row.id));
  await tx.update(valoExportObjects).set({state:"cleanup",nextCleanupAt:new Date()}).where(eq(valoExportObjects.workspaceExportJobId,row.id));
  const[result]=await tx.update(jobs).set({status,version:row.version+1,queueId:randomUUID(),leaseExpiresAt:null,updatedAt:new Date()})
    .where(eq(jobs.id,row.id)).returning();return result!;
}
export async function actOnWorkspaceExport(actor:WorkspaceActor,id:string,raw:unknown,action:"cancel"|"retry"){
  assertDevelopmentRuntime();const input=CancelWorkspaceDataExportBody.strict().parse(raw);
  return db.transaction(async tx=>{
    if(action==="retry")await tx.select({id:valoWorkspaces.id}).from(valoWorkspaces).where(eq(valoWorkspaces.id,actor.workspaceId)).for("update");
    const row=await readOwned(tx,actor,id);
    if(row.version!==input.expectedVersion)throw new ValoProblem(409,"This export changed. Reload its current status before trying again.");
    if(action==="cancel"){
      if(![...active,"ready"].includes(row.status))throw new ValoProblem(409,"This export is no longer preparing or available.");
      return workspaceExportView(await withdraw(tx,row,"cancelled"));
    }
    if(row.status!=="failed"||row.retryCycles>=2)throw new ValoProblem(409,"This export cannot be retried. Start a new request if one is needed.");
    // The workspace lock above serializes retries with new requests.
    const[pending]=await tx.select({id:jobs.id}).from(jobs).where(and(owned(actor),inArray(jobs.status,[...active]))).limit(1);
    if(pending)throw new ValoProblem(409,"Another export is already being prepared.");
    const[result]=await tx.update(jobs).set({status:"queued",version:row.version+1,queueId:randomUUID(),attempts:0,
      retryCycles:row.retryCycles+1,leaseRecoveries:0,leaseExpiresAt:null,nextAttemptAt:new Date(),rowsProcessed:0,
      bytesPrepared:0,errorCode:null,expiresAt:null,updatedAt:new Date()}).where(eq(jobs.id,id)).returning();
    return workspaceExportView(result!);
  });
}
async function currentWorker(tx:Tx,id:string,queueId:string,actor:WorkspaceActor,authorize=true){
  const[row]=await tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.workspaceId,actor.workspaceId))).for("update",{skipLocked:!authorize});
  if(!row||row.status!=="running"||row.queueId!==queueId||!row.leaseExpiresAt||row.leaseExpiresAt.getTime()<=Date.now())
    throw Error("WORKSPACE_EXPORT_GENERATION_ENDED");
  if(authorize)await authorizeWorkspaceWrite(tx,actor);return row;
}
export type WorkspaceExportStage="claimed"|"collecting"|"collected"|"uploading"|"uploaded"|"completing"|"completed";
/** Storage dependency is server-owned. No request/env value can choose its implementation. */
export async function executeWorkspaceExport(id:string,workspaceId:string,queueId:string,options:{
  storage?:WorkspaceExportStorage;onStage?:(stage:WorkspaceExportStage)=>Promise<void>;
}={}){
  assertDevelopmentRuntime();const storage=options.storage??nativeWorkspaceExportStorage;
  const generation=await db.transaction(async tx=>{
    const[row]=await tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.workspaceId,workspaceId))).for("update");
    if(!row||row.queueId!==queueId||!["queued","retrying"].includes(row.status)||row.nextAttemptAt.getTime()>Date.now())return null;
    const actor={workspaceId,identityId:row.requestedBy};await authorizeWorkspaceWrite(tx,actor);
    if(row.attempts>=3)return null;
    const assetId=randomUUID(),key=`valo/development/${workspaceId}/${assetId}.json`;
    await tx.update(jobs).set({status:"running",attempts:row.attempts+1,version:row.version+1,rowsProcessed:0,bytesPrepared:0,
      leaseExpiresAt:new Date(Date.now()+WORKSPACE_EXPORT_LEASE_MS),updatedAt:new Date()}).where(eq(jobs.id,id));
    // Reserve before any collection/upload. Quarantine can seal even a future late write.
    await tx.insert(valoExportObjects).values({objectKey:key,workspaceId,workspaceExportJobId:id,queueId,state:"pending"});
    return{actor,assetId,key,attempts:row.attempts+1};
  });
  if(!generation)return;
  const {actor,assetId,key}=generation;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(WORKSPACE_EXPORT_ATTEMPT_MS)]);
  let directory:string|undefined,beating=false,bytes=0,rows=0;
  const heartbeat=async()=>{
    if(beating)return;beating=true;
    try{await db.transaction(async tx=>{
      await tx.execute(sql`SET LOCAL lock_timeout = '250ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`);
      // The snapshot holds its own membership lock. Do not reacquire it from
      // another transaction behind a waiting privacy revocation.
      await currentWorker(tx,id,queueId,actor,false);
      await tx.update(jobs).set({leaseExpiresAt:new Date(Date.now()+WORKSPACE_EXPORT_LEASE_MS),rowsProcessed:rows,bytesPrepared:bytes,updatedAt:new Date()}).where(eq(jobs.id,id));
    });}catch(error){controller.abort(error);}finally{beating=false;}
  };
  const timer=setInterval(()=>{void heartbeat();},10_000);timer.unref();
  try{
    await options.onStage?.("claimed");signal.throwIfAborted();
    directory=await mkdtemp(join(tmpdir(),"valo-durable-export-"));const path=join(directory,"workspace.json"),file=await open(path,"wx",0o600);
    try{await workspaceDataExport(actor,async chunk=>{
      signal.throwIfAborted();bytes+=Buffer.byteLength(chunk);if(bytes>WORKSPACE_EXPORT_MAX_BYTES)throw Error("WORKSPACE_EXPORT_SIZE_LIMIT");
      await file.writeFile(chunk,"utf8");
    },signal,async count=>{rows=count;await options.onStage?.("collecting");await heartbeat();signal.throwIfAborted();});}finally{await file.close();}
    await options.onStage?.("collected");signal.throwIfAborted();
    await db.transaction(tx=>currentWorker(tx,id,queueId,actor));
    const stored=await storage.write(key,path,signal,()=>options.onStage?.("uploading")??Promise.resolve());
    await options.onStage?.("uploaded");signal.throwIfAborted();
    await db.transaction(async tx=>{
      const row=await currentWorker(tx,id,queueId,actor);
      const expiry=new Date(Date.now()+24*60*60_000);
      await tx.insert(valoFileAssets).values({id:assetId,workspaceId,workspaceExportJobId:id,objectKey:key,...stored,
        mime:"application/json",retentionAt:expiry});
      await tx.update(valoExportObjects).set({state:"retained"}).where(eq(valoExportObjects.objectKey,key));
      await tx.update(jobs).set({status:"ready",version:row.version+1,leaseExpiresAt:null,errorCode:null,expiresAt:expiry,
        rowsProcessed:rows,bytesPrepared:stored.size,updatedAt:new Date()}).where(eq(jobs.id,id));
      await options.onStage?.("completing");
    });
    await options.onStage?.("completed");
  }catch(error){
    const message=error instanceof Error?error.message:"";
    const denied=error instanceof ValoProblem&&[403,404].includes(error.status);
    const safe=denied?"WORKSPACE_EXPORT_ACCESS_REVOKED":message==="WORKSPACE_EXPORT_SIZE_LIMIT"?message:
      signal.aborted?"WORKSPACE_EXPORT_INTERRUPTED":"WORKSPACE_EXPORT_STORAGE_UNAVAILABLE";
    await db.transaction(async tx=>{
      const[row]=await tx.select().from(jobs).where(eq(jobs.id,id)).for("update");
      if(row?.queueId===queueId&&row.status==="running"){
        const retry=row.attempts<3&&!denied&&safe!=="WORKSPACE_EXPORT_SIZE_LIMIT";
        await tx.update(jobs).set({status:retry?"retrying":"failed",version:row.version+1,queueId:randomUUID(),leaseExpiresAt:null,
          nextAttemptAt:new Date(Date.now()+5_000*row.attempts),errorCode:safe,updatedAt:new Date()}).where(eq(jobs.id,id));
      }
      const[asset]=await tx.select({id:valoFileAssets.id}).from(valoFileAssets).where(eq(valoFileAssets.objectKey,key)).limit(1);
      if(!asset)await tx.update(valoExportObjects).set({state:"cleanup",nextCleanupAt:new Date()}).where(eq(valoExportObjects.objectKey,key));
    });
    // A completed erasure may already have deleted both metadata tables.
    await db.update(valoPrivacyTombstones).set({nextReplayAt:new Date()}).where(eq(valoPrivacyTombstones.workspaceId,workspaceId));
  }finally{clearInterval(timer);controller.abort();if(directory)await rm(directory,{recursive:true,force:true});}
}
export async function recoverWorkspaceExports(){
  assertDevelopmentRuntime();return db.transaction(async tx=>{
    const rows=await tx.select().from(jobs).where(and(inArray(jobs.status,[...active]),
      sql`coalesce(${jobs.leaseExpiresAt},${jobs.updatedAt}+interval '90 seconds')<now()`)).limit(25).for("update",{skipLocked:true});
    for(const row of rows){
      const exhausted=row.attempts>=3||row.leaseRecoveries>=2;
      await tx.update(jobs).set({status:exhausted?"failed":"queued",version:row.version+1,queueId:randomUUID(),
        leaseRecoveries:row.leaseRecoveries+1,leaseExpiresAt:null,nextAttemptAt:new Date(),errorCode:"WORKSPACE_EXPORT_WORKER_INTERRUPTED",updatedAt:new Date()}).where(eq(jobs.id,row.id));
      await tx.update(valoExportObjects).set({state:"cleanup",nextCleanupAt:new Date()})
        .where(and(eq(valoExportObjects.workspaceExportJobId,row.id),eq(valoExportObjects.state,"pending")));
    }
    return rows.length;
  });
}
export async function expireWorkspaceExports(){
  assertDevelopmentRuntime();return db.transaction(async tx=>{
    const rows=await tx.select().from(jobs).where(and(eq(jobs.status,"ready"),lte(jobs.expiresAt,new Date())))
      .limit(25).for("update",{skipLocked:true});
    for(const row of rows)await withdraw(tx,row,"expired");return rows.length;
  });
}
export async function pendingWorkspaceExports(){
  assertDevelopmentRuntime();return db.select({id:jobs.id,workspaceId:jobs.workspaceId,queueId:jobs.queueId}).from(jobs)
    .where(and(inArray(jobs.status,["queued","retrying"]),lte(jobs.nextAttemptAt,new Date()))).limit(25);
}
export async function withPreparedWorkspaceExport<T>(actor:WorkspaceActor,id:string,consume:(path:string)=>Promise<T>,options:{
  signal?:AbortSignal;beforeRelease:()=>Promise<void>;storage?:WorkspaceExportStorage;
}){
  assertDevelopmentRuntime();const storage=options.storage??nativeWorkspaceExportStorage;
  const binding=await db.transaction(async tx=>{
    const row=await readOwned(tx,actor,id);
    if(row.status!=="ready"||!row.expiresAt||row.expiresAt.getTime()<=Date.now())throw new ValoProblem(409,"This export is not available. Reload its status.");
    const[asset]=await tx.select().from(valoFileAssets).where(and(eq(valoFileAssets.workspaceExportJobId,id),eq(valoFileAssets.workspaceId,actor.workspaceId))).limit(1);
    if(!asset||asset.withdrawnAt||asset.mime!=="application/json")throw new ValoProblem(409,"The private export is not available.");
    return{row,asset};
  });
  return storage.withFile(binding.asset.objectKey,binding.asset.checksum,binding.asset.size,async path=>{
    options.signal?.throwIfAborted();await options.beforeRelease();options.signal?.throwIfAborted();
    return db.transaction(async tx=>{
      const row=await readOwned(tx,actor,id);
      if(row.status!=="ready"||row.version!==binding.row.version||!row.expiresAt||row.expiresAt.getTime()<=Date.now())
        throw new ValoProblem(409,"This export expired or was cancelled before release.");
      const[asset]=await tx.select().from(valoFileAssets).where(eq(valoFileAssets.id,binding.asset.id)).limit(1);
      if(!asset||asset.withdrawnAt||asset.checksum!==binding.asset.checksum||asset.objectKey!==binding.asset.objectKey)
        throw new ValoProblem(409,"The private export changed before release.");
      // Hold job and membership locks through release. Cancellation/revocation
      // committed before this point wins; after handoff bytes cannot be recalled.
      options.signal?.throwIfAborted();return consume(path);
    });
  },options.signal);
}
