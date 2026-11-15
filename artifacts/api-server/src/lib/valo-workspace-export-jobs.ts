import {randomUUID} from "node:crypto";
import {mkdir,open,rm,mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {and,or,eq,desc,lt,sql,inArray} from "drizzle-orm";
import {db,valoWorkspaceExports as jobs,valoWorkspaceExportAttempts as attempts,valoPrivacyTombstones,type WorkspaceExport} from "@workspace/db";
import {authorizeWorkspaceRead,authorizeWorkspaceWrite,type WorkspaceActor,ValoProblem} from "./valo-store";
import {workspaceDataExport} from "./valo-customer-access";
import {workspaceExportStorage,workspaceFileDigest,WORKSPACE_EXPORT_MAX_BYTES,WORKSPACE_EXPORT_ATTEMPT_MS,type WorkspaceExportStorage} from "./valo-workspace-export-storage";
import {abortable} from "./valo-abort";
import {assertApplicationRuntime,runtimeEnvironment} from "./valo-runtime-activation";
import {privateCleanupAuthority} from "./valo-private-cleanup-authority";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export const WORKSPACE_EXPORT_QUEUE="valo-workspace-data-v1";
export const WORKSPACE_EXPORT_LEASE_MS=90_000;
export const WORKSPACE_EXPORT_NOTICE="Includes the named application sections, not complete privacy fulfilment. External processors, identity records, other people's activity and private document files are excluded. Background preparation continues when this page closes. Retry creates a new dated copy; partial copies are never combined. Results are available until the displayed expiry (24 hours after the original request).";
export const workspaceExportScratch=(attempt:string)=>join(tmpdir(),"valo-workspace-export-"+attempt);
const view=(r:WorkspaceExport)=>({id:r.id,status:r.status!=="cancelled"&&r.expiresAt.getTime()<=Date.now()?"expired" as const:r.status,version:r.version,
  attempts:r.attempts,createdAt:r.createdAt.toISOString(),expiresAt:r.expiresAt.toISOString(),snapshotAt:r.snapshotAt?.toISOString()??null,
  size:r.size,counts:r.counts,errorCode:r.errorCode,notice:WORKSPACE_EXPORT_NOTICE,
  progress:{section:r.progressSection,rows:r.rowsProcessed,bytes:r.bytesPrepared},
  retryAvailable:r.status==="interrupted"&&r.attempts<5&&r.expiresAt.getTime()>Date.now()});
async function owned(tx:Tx,actor:WorkspaceActor,id:string,lock=false){
  if(lock)await tx.execute(sql`set local lock_timeout='1000ms'`);
  const q=tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.workspaceId,actor.workspaceId),eq(jobs.requesterId,actor.identityId)));
  const[row]=await(lock?q.for("update"):q);
  if(!row)throw new ValoProblem(404,"Workspace export not found.");
  await authorizeWorkspaceRead(tx,actor);return row;
}
export async function listWorkspaceExports(actor:WorkspaceActor,cursor?:string){
  assertApplicationRuntime();return db.transaction(async tx=>{await authorizeWorkspaceRead(tx,actor);
    const scope=and(eq(jobs.workspaceId,actor.workspaceId),eq(jobs.requesterId,actor.identityId));
    const[anchor]=cursor?await tx.select({id:jobs.id,createdAt:jobs.createdAt}).from(jobs).where(and(scope,eq(jobs.id,cursor))):[];
    if(cursor&&!anchor)throw new ValoProblem(409,"The export list changed. Reload the newest requests.");
    const rows=await tx.select().from(jobs).where(and(scope,anchor?or(lt(jobs.createdAt,anchor.createdAt),
      and(eq(jobs.createdAt,anchor.createdAt),lt(jobs.id,anchor.id))):undefined)).orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(26);
    return{items:rows.slice(0,25).map(view),nextCursor:rows.length>25?rows[24]!.id:null};
  });
}
export async function getWorkspaceExport(actor:WorkspaceActor,id:string){
  assertApplicationRuntime();return db.transaction(async tx=>view(await owned(tx,actor,id)));
}
export async function createWorkspaceExport(actor:WorkspaceActor,requestKey:string){
  assertApplicationRuntime();return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actor.workspaceId+"workspace-export"},0))`);
    await authorizeWorkspaceRead(tx,actor);
    const[old]=await tx.select().from(jobs).where(and(eq(jobs.workspaceId,actor.workspaceId),eq(jobs.requesterId,actor.identityId),eq(jobs.requestKey,requestKey)));
    if(old)return view(old);
    await tx.update(jobs).set({status:"expired",version:sql`${jobs.version}+1`,queueId:randomUUID(),leaseUntil:null})
      .where(and(eq(jobs.workspaceId,actor.workspaceId),lt(jobs.expiresAt,new Date()),sql`${jobs.status} NOT IN ('expired','cancelled')`));
    const[active]=await tx.select().from(jobs).where(and(eq(jobs.workspaceId,actor.workspaceId),inArray(jobs.status,["queued","preparing","interrupted"])));
    if(active){if(active.requesterId===actor.identityId)return view(active);throw new ValoProblem(409,"An export is already being prepared for this workspace.");}
    const[c]=await tx.select({minute:sql<number>`count(*) filter(where created_at>now()-interval '1 minute')::int`,
      day:sql<number>`count(*)::int`}).from(jobs).where(and(eq(jobs.workspaceId,actor.workspaceId),sql`created_at>now()-interval '1 day'`));
    if(c!.minute>=10||c!.day>=50)throw new ValoProblem(429,"Workspace export limit reached. Saved data and prepared results are unchanged.",undefined,60);
    await authorizeWorkspaceWrite(tx,actor);
    const[row]=await tx.insert(jobs).values({id:randomUUID(),workspaceId:actor.workspaceId,requesterId:actor.identityId,requestKey,
      expiresAt:new Date(Date.now()+86400000)}).returning();return view(row!);
  });
}
export async function cancelWorkspaceExport(actor:WorkspaceActor,id:string,expectedVersion?:number){
  assertApplicationRuntime();return db.transaction(async tx=>{const job=await owned(tx,actor,id,true);
    if(expectedVersion!==undefined&&job.version!==expectedVersion)throw new ValoProblem(409,"This export changed. Reload its current status before trying again.");
    await authorizeWorkspaceWrite(tx,actor);
    const[row]=await tx.update(jobs).set({status:"cancelled",version:job.version+1,queueId:randomUUID(),leaseUntil:null,updatedAt:new Date()}).where(eq(jobs.id,id)).returning();
    await tx.update(attempts).set({status:"cleanup",cleanupCheckedAt:null,nextCleanupAt:new Date(),cleanupErrorCode:null}).where(eq(attempts.jobId,id));
    return view(row!);});
}
export async function retryWorkspaceExport(actor:WorkspaceActor,id:string,expectedVersion:number){
  assertApplicationRuntime();return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actor.workspaceId+"workspace-export"},0))`);
    const job=await owned(tx,actor,id,true);
    if(job.version!==expectedVersion)throw new ValoProblem(409,"This export changed. Reload its current status before trying again.");
    if(job.status!=="interrupted"||job.attempts>=5||job.expiresAt.getTime()<=Date.now())
      throw new ValoProblem(409,"This export cannot be retried. Discard it and request a new snapshot if needed.");
    await authorizeWorkspaceWrite(tx,actor);
    const[row]=await tx.update(jobs).set({status:"queued",version:job.version+1,queueId:randomUUID(),leaseUntil:null,
      errorCode:null,progressSection:null,rowsProcessed:0,bytesPrepared:0,updatedAt:new Date()}).where(eq(jobs.id,id)).returning();
    return view(row!);
  });
}
async function current(tx:Tx,actor:WorkspaceActor,id:string,attemptId:string,queueId:string,heartbeat=false){
  if(heartbeat){await tx.execute(sql`set local lock_timeout='250ms'`);await tx.execute(sql`set local statement_timeout='1000ms'`);}
  else await tx.execute(sql`set local lock_timeout='1000ms'`);
  const[row]=await tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.workspaceId,actor.workspaceId)))
    .for("update",heartbeat?{skipLocked:true}:{});
  if(!row||row.currentAttemptId!==attemptId||row.queueId!==queueId||row.status!=="preparing"||
    !row.leaseUntil||row.leaseUntil.getTime()<=Date.now()||row.expiresAt.getTime()<=Date.now())
    throw new ValoProblem(409,"This preparation was cancelled, superseded or expired.");
  // Short current reads during heartbeat never retain authorization locks across
  // a snapshot. Final writes retain a membership lock through commit.
  if(heartbeat)await authorizeWorkspaceRead(tx,actor);else await authorizeWorkspaceWrite(tx,actor);
  return row;
}
export type WorkspaceExportStage="claimed"|"collecting"|"collected"|"uploading"|"uploaded"|"completing"|"completed";
/** Invoked by the trusted worker (and controlled tests), never by GET/download.
 * Every attempt is reserved before I/O and fenced by both queue and attempt ID. */
export async function executeWorkspaceExport(id:string,workspaceId:string,queueId:string,options:{
  storage?:WorkspaceExportStorage;signal?:AbortSignal;onStage?:(stage:WorkspaceExportStage)=>Promise<void>;
  onPage?:(section:string,rows:number)=>Promise<void>;
}={}){
  assertApplicationRuntime();const storage=options.storage??workspaceExportStorage;
  const claim=await db.transaction(async tx=>{
    await tx.execute(sql`set local lock_timeout='1000ms'`);
    const[old]=await tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.workspaceId,workspaceId))).for("update");
    if(!old||old.queueId!==queueId||old.status!=="queued"||old.attempts>=5||old.expiresAt.getTime()<=Date.now())return null;
    const actor={workspaceId,identityId:old.requesterId};
    try{await authorizeWorkspaceWrite(tx,actor);}catch(error){
      if(!(error instanceof ValoProblem)||error.status!==403)throw error;
      await tx.update(jobs).set({status:"interrupted",version:old.version+1,queueId:randomUUID(),errorCode:"WORKSPACE_EXPORT_ACCESS_REVOKED",updatedAt:new Date()}).where(eq(jobs.id,id));return null;
    }
    const attemptId=randomUUID(),key=`valo/${runtimeEnvironment()}/${workspaceId}/${attemptId}.json`;
    await tx.update(attempts).set({status:"cleanup",cleanupCheckedAt:null,nextCleanupAt:new Date(),cleanupErrorCode:null}).where(eq(attempts.jobId,id));
    await tx.insert(attempts).values({id:attemptId,jobId:id,workspaceId,objectKey:key});
    await tx.update(jobs).set({status:"preparing",attempts:old.attempts+1,version:old.version+1,currentAttemptId:attemptId,
      leaseUntil:new Date(Date.now()+WORKSPACE_EXPORT_LEASE_MS),errorCode:null,progressSection:null,rowsProcessed:0,bytesPrepared:0,updatedAt:new Date()}).where(eq(jobs.id,id));
    return{actor,attemptId,key};
  });
  if(!claim)return;
  const {actor,attemptId,key}=claim,controller=new AbortController();
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(WORKSPACE_EXPORT_ATTEMPT_MS),...(options.signal?[options.signal]:[])]);
  const directory=workspaceExportScratch(attemptId),path=join(directory,"workspace.json");
  let bytes=0,rows=0,section:string|null=null,beating=false;
  const sections=new Map<string,number>();
  const heartbeat=async()=>{
    if(beating)return;beating=true;
    try{await db.transaction(async tx=>{
      await current(tx,actor,id,attemptId,queueId,true);
      await tx.update(jobs).set({leaseUntil:new Date(Date.now()+WORKSPACE_EXPORT_LEASE_MS),progressSection:section,
        rowsProcessed:rows,bytesPrepared:bytes,updatedAt:new Date()}).where(eq(jobs.id,id));
    });}catch(error){controller.abort(error);}finally{beating=false;}
  };
  const timer=setInterval(()=>{void heartbeat();},10_000);timer.unref();
  try{
    await options.onStage?.("claimed");signal.throwIfAborted();await mkdir(directory,{mode:0o700});
    const file=await open(path,"wx",0o600);let snapshot:Awaited<ReturnType<typeof workspaceDataExport>>;
    try{snapshot=await workspaceDataExport(actor,async chunk=>{signal.throwIfAborted();bytes+=Buffer.byteLength(chunk);
      if(bytes>WORKSPACE_EXPORT_MAX_BYTES)throw Error("WORKSPACE_EXPORT_SIZE_LIMIT");await file.writeFile(chunk,"utf8");},signal,
      async(name,count)=>{section=name;sections.set(name,count);rows=[...sections.values()].reduce((a,b)=>a+b,0);
        await options.onStage?.("collecting");await options.onPage?.(name,count);await heartbeat();signal.throwIfAborted();});
    }finally{await file.close();}
    await options.onStage?.("collected");signal.throwIfAborted();const proof=await workspaceFileDigest(path,signal);
    await db.transaction(async tx=>{await current(tx,actor,id,attemptId,queueId);await tx.update(attempts).set({status:"uploading"}).where(eq(attempts.id,attemptId));});
    await options.onStage?.("uploading");signal.throwIfAborted();
    const upload=storage.put(key,path,signal);
    // Never delete directly after a late accepted write: a held/quarantined case
    // owns that authority. The immutable reservation/replay key remains tracked.
    void upload.then(async()=>{if(signal.aborted)await requestAttemptCleanup(workspaceId,id,attemptId);},()=>{}).catch(()=>{});
    await abortable(signal,()=>upload);await options.onStage?.("uploaded");signal.throwIfAborted();
    const verification=join(directory,"verified.json");await storage.get(key,verification,signal);
    const verified=await workspaceFileDigest(verification,signal);
    if(proof.checksum!==verified.checksum||proof.size!==verified.size)throw Error("PRIVATE_OBJECT_VERIFICATION_FAILED");
    await db.transaction(async tx=>{
      const row=await current(tx,actor,id,attemptId,queueId);signal.throwIfAborted();
      await tx.update(attempts).set({status:"ready"}).where(eq(attempts.id,attemptId));
      await tx.update(jobs).set({status:"ready",version:row.version+1,leaseUntil:null,...proof,counts:snapshot.counts,scope:snapshot.scope,
        rowsProcessed:rows,bytesPrepared:proof.size,snapshotAt:new Date(snapshot.exportedAt),updatedAt:new Date()}).where(eq(jobs.id,id));
      await options.onStage?.("completing");
    });
    await options.onStage?.("completed");
  }catch(error){
    // Snapshot/file cleanup is complete before waiting for job locks; a cancel
    // or revocation cannot trap a heartbeat behind this worker's own snapshot.
    const message=error instanceof Error?error.message:"";
    await db.transaction(async tx=>{
      await tx.update(jobs).set({status:"interrupted",version:sql`${jobs.version}+1`,queueId:randomUUID(),leaseUntil:null,
        errorCode:message==="WORKSPACE_EXPORT_SIZE_LIMIT"?message:signal.aborted?"WORKSPACE_EXPORT_INTERRUPTED":"PREPARATION_NOT_RELEASED",updatedAt:new Date()})
        .where(and(eq(jobs.id,id),eq(jobs.queueId,queueId),eq(jobs.currentAttemptId,attemptId),eq(jobs.status,"preparing")));
    });
    await requestAttemptCleanup(workspaceId,id,attemptId);
  }finally{clearInterval(timer);controller.abort();await rm(directory,{recursive:true,force:true});}
}
async function requestAttemptCleanup(workspaceId:string,id:string,attemptId:string){
  await db.update(attempts).set({status:"cleanup",cleanupCheckedAt:null,nextCleanupAt:new Date(),cleanupErrorCode:null})
    .where(and(eq(attempts.id,attemptId),eq(attempts.jobId,id),sql`${attempts.status}<>'ready'`));
  // Completed erasure may have deleted metadata; the sealed key survives.
  await db.update(valoPrivacyTombstones).set({nextReplayAt:new Date()}).where(eq(valoPrivacyTombstones.workspaceId,workspaceId));
}
/** Compatibility entry for server-owned native interruption fixtures only.
 * Customer HTTP never invokes it. Session verification is still used at release. */
export async function prepareWorkspaceExport(actor:WorkspaceActor,id:string,signal:AbortSignal,verify:()=>Promise<void>,
  storage:WorkspaceExportStorage=workspaceExportStorage,onPage?:(section:string,rows:number)=>Promise<void>){
  assertApplicationRuntime();await abortable(signal,verify);
  const row=await db.transaction(tx=>owned(tx,actor,id));
  await executeWorkspaceExport(id,actor.workspaceId,row.queueId,{storage,signal,onPage:async(s,n)=>{await verify();await onPage?.(s,n);}});
}
export async function pendingWorkspaceExports(){
  assertApplicationRuntime();return db.select({id:jobs.id,workspaceId:jobs.workspaceId,queueId:jobs.queueId}).from(jobs)
    .where(and(eq(jobs.status,"queued"),sql`${jobs.expiresAt}>now()`)).orderBy(jobs.createdAt,jobs.id).limit(25);
}
export async function recoverWorkspaceExports(workspaceId?:string){
  assertApplicationRuntime();return db.transaction(async tx=>{
    const rows=await tx.select().from(jobs).where(and(
      sql`((${jobs.status}='preparing' AND ${jobs.leaseUntil}<now()) OR (${jobs.status}='queued' AND ${jobs.updatedAt}<now()-interval '90 seconds'))`,
      workspaceId?eq(jobs.workspaceId,workspaceId):undefined)).limit(25).for("update",{skipLocked:true});
    for(const row of rows){
      await tx.update(jobs).set({status:row.expiresAt.getTime()<=Date.now()?"expired":row.attempts<5?"queued":"interrupted",
        version:row.version+1,queueId:randomUUID(),leaseUntil:null,errorCode:"ABANDONED_PREPARATION",updatedAt:new Date()}).where(eq(jobs.id,row.id));
      await tx.update(attempts).set({status:"cleanup",cleanupCheckedAt:null,nextCleanupAt:new Date(),cleanupErrorCode:null}).where(eq(attempts.jobId,row.id));
    }return rows.length;
  });
}
/** Recheck the exact ready attempt and current session after private retrieval.
 * Job + membership locks define byte release: earlier cancellation/revocation
 * wins. Browser-owned bytes already released cannot be recalled. */
export async function withPreparedWorkspaceExport<T>(actor:WorkspaceActor,id:string,signal:AbortSignal,
  verify:()=>Promise<void>,consume:(path:string,proof:{size:number;checksum:string},signal:AbortSignal)=>Promise<T>,storage:WorkspaceExportStorage=workspaceExportStorage){
  assertApplicationRuntime();await abortable(signal,verify);
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(WORKSPACE_EXPORT_ATTEMPT_MS)]);
  const result=await db.transaction(async tx=>{
    const row=await owned(tx,actor,id);
    if(row.status!=="ready"||row.expiresAt.getTime()<=Date.now()||!row.currentAttemptId||!row.checksum||!row.size)
      throw new ValoProblem(409,"No complete unexpired artifact is available. Check the recorded preparation status.");
    const[attempt]=await tx.select().from(attempts).where(and(eq(attempts.id,row.currentAttemptId),eq(attempts.jobId,id),
      eq(attempts.workspaceId,actor.workspaceId),eq(attempts.status,"ready")));
    if(!attempt||attempt.objectKey!==`valo/${runtimeEnvironment()}/${actor.workspaceId}/${attempt.id}.json`)
      throw new ValoProblem(409,"Private artifact verification is unavailable.");
    return{row,key:attempt.objectKey};
  });
  // Downloads are private copies too. Keep their temporary bytes beneath the
  // attempt's existing signed scratch locator so erasure/replay can remove a
  // process-death leftover without guessing ownership from a random directory.
  const scratch=workspaceExportScratch(result.row.currentAttemptId!);
  await mkdir(scratch,{recursive:true,mode:0o700});
  const directory=await mkdtemp(join(scratch,"download-")),path=join(directory,"workspace.json");
  try{
    bounded.throwIfAborted();await storage.get(result.key,path,bounded);const proof=await workspaceFileDigest(path,bounded);
    if(proof.checksum!==result.row.checksum||proof.size!==result.row.size)throw new ValoProblem(409,"Private result integrity check failed. No bytes were released.");
    await abortable(bounded,verify);
    return await db.transaction(async tx=>{
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      const row=await owned(tx,actor,id,true);await authorizeWorkspaceWrite(tx,actor);bounded.throwIfAborted();
      if(row.status!=="ready"||row.version!==result.row.version||row.currentAttemptId!==result.row.currentAttemptId||row.expiresAt.getTime()<=Date.now())
        throw new ValoProblem(409,"Result access changed during retrieval.");
      const[a]=await tx.select().from(attempts).where(eq(attempts.id,row.currentAttemptId!));
      if(!a||a.status!=="ready"||a.objectKey!==result.key||a.workspaceId!==actor.workspaceId||a.jobId!==id)
        throw new ValoProblem(409,"Private artifact verification changed.");
      // A competing release may have delayed the job lock. Check the managed
      // session again after that wait, immediately before attachment release.
      await abortable(bounded,verify);bounded.throwIfAborted();
      return await consume(path,proof,bounded);
    });
  }finally{await rm(directory,{force:true,recursive:true});}
}
export async function retireWorkspaceExports(tx:Tx,workspaceId:string){
  // Quarantine already revokes every membership. Bound metadata work without
  // delaying that fence or changing the signed erasure phase array.
  const changed=await tx.execute(sql`UPDATE valo_workspace_exports SET status='cancelled',version=version+1,
    queue_id=gen_random_uuid(),lease_until=NULL,updated_at=now() WHERE ctid IN
    (SELECT ctid FROM valo_workspace_exports WHERE workspace_id=${workspaceId}::uuid AND status<>'cancelled' LIMIT 100)`);
  const used=changed.rowCount??0;
  if(used<100)await tx.execute(sql`UPDATE valo_workspace_export_attempts SET status='cleanup',cleanup_checked_at=NULL,
    next_cleanup_at=now(),cleanup_error_code=NULL WHERE ctid IN
    (SELECT ctid FROM valo_workspace_export_attempts WHERE workspace_id=${workspaceId}::uuid AND status<>'cleanup' LIMIT ${100-used})`);
  return{rowCount:used};
}
export async function cleanupWorkspaceExports(storage:WorkspaceExportStorage=workspaceExportStorage,workspaceId?:string){
  assertApplicationRuntime();await recoverWorkspaceExports(workspaceId);
  await db.transaction(async tx=>{
    const due=await tx.select({id:jobs.id}).from(jobs).where(and(lt(jobs.expiresAt,new Date()),
      sql`${jobs.status} NOT IN ('expired','cancelled')`,workspaceId?eq(jobs.workspaceId,workspaceId):undefined))
      .orderBy(jobs.expiresAt,jobs.id).limit(25).for("update",{skipLocked:true});
    if(due.length)await tx.update(jobs).set({status:"expired",version:sql`${jobs.version}+1`,queueId:randomUUID(),leaseUntil:null})
      .where(inArray(jobs.id,due.map(row=>row.id)));
  });
  // Persist a short retry reservation BEFORE case/object work. Invalid keys,
  // holds, lock waits and process death cannot monopolize the first five rows.
  // This transaction releases attempt locks before acquiring privacy authority.
  const rows=await db.transaction(async tx=>{
    const due=await tx.select({a:attempts}).from(attempts).innerJoin(jobs,and(eq(attempts.jobId,jobs.id),eq(attempts.workspaceId,jobs.workspaceId)))
      .where(and(sql`(${attempts.status}='cleanup' OR ${jobs.status} IN ('cancelled','expired'))`,
        sql`${attempts.nextCleanupAt}<=now()`,workspaceId?eq(attempts.workspaceId,workspaceId):undefined))
      .orderBy(attempts.nextCleanupAt,attempts.id).limit(5).for("update",{of:attempts,skipLocked:true});
    if(due.length)await tx.update(attempts).set({nextCleanupAt:new Date(Date.now()+60_000),
      cleanupAttempts:sql`least(${attempts.cleanupAttempts},2147483646)+1`}).where(inArray(attempts.id,due.map(({a})=>a.id)));
    return due;
  });
  let failed=0,held=0,privacyHeld=0,cleaned=0;
  for(const{a}of rows){await db.transaction(async tx=>{
    await tx.execute(sql`set local lock_timeout='1000ms'`);
    // Case authority precedes attempt locks; quarantine/sealing owns all keys.
    const authority=await privateCleanupAuthority(tx,a.workspaceId);
    const[currentAttempt]=await tx.select().from(attempts).where(eq(attempts.id,a.id)).for("update",{skipLocked:true});
    if(!currentAttempt)return;
    const[job]=await tx.select().from(jobs).where(and(eq(jobs.id,currentAttempt.jobId),eq(jobs.workspaceId,a.workspaceId)));
    if(!job||!(currentAttempt.status==="cleanup"||["cancelled","expired"].includes(job.status)))return;
    if(!authority.allowed){
      held++;if(authority.privacyOwned)privacyHeld++;
      await tx.update(attempts).set({cleanupErrorCode:authority.privacyOwned?"PRIVACY_REPLAY_OWNED":"PRIVACY_HOLD"})
        .where(eq(attempts.id,a.id));return;
    }
    if(currentAttempt.workspaceId!==a.workspaceId||currentAttempt.objectKey!==`valo/${runtimeEnvironment()}/${a.workspaceId}/${a.id}.json`){
      failed++;await tx.update(attempts).set({cleanupErrorCode:"INVALID_PRIVATE_KEY",nextCleanupAt:new Date(Date.now()+3_600_000)})
        .where(eq(attempts.id,a.id));return;
    }
    try{
      await storage.remove(currentAttempt.objectKey);await rm(workspaceExportScratch(a.id),{force:true,recursive:true});
      cleaned++;await tx.update(attempts).set({cleanupCheckedAt:new Date(),cleanupErrorCode:null,nextCleanupAt:new Date(Date.now()+3_600_000)})
        .where(eq(attempts.id,a.id));
    }catch{
      failed++;const delay=Math.min(3_600_000,30_000*2**Math.min(7,Math.max(0,currentAttempt.cleanupAttempts-1)));
      await tx.update(attempts).set({cleanupErrorCode:"STORAGE_DELETE_FAILED",nextCleanupAt:new Date(Date.now()+delay)})
        .where(eq(attempts.id,a.id));
    }
  });}
  return{checked:rows.length,failed,held,privacyHeld,cleaned};
}
