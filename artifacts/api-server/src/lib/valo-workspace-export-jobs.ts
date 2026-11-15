import {randomUUID} from "node:crypto";
import {mkdir,open,rm,mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {and,eq,desc,lt,sql,inArray} from "drizzle-orm";
import {db,valoWorkspaceExports as jobs,valoWorkspaceExportAttempts as attempts,valoPrivacyTombstones,type WorkspaceExport} from "@workspace/db";
import {authorizeWorkspaceRead,authorizeWorkspaceWrite,type WorkspaceActor,ValoProblem} from "./valo-store";
import {workspaceDataExport} from "./valo-customer-access";
import {workspaceExportStorage,workspaceFileDigest,type WorkspaceExportStorage} from "./valo-workspace-export-storage";
import {abortable} from "./valo-abort";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export const WORKSPACE_EXPORT_NOTICE="Includes the named application sections, not complete privacy fulfilment. External processors, identity records, other people's activity and private document files are excluded. If preparation is interrupted, retry creates a new dated copy; partial copies are never combined. Prepared private results expire after 24 hours.";
export const workspaceExportScratch=(attempt:string)=>join(tmpdir(),"valo-workspace-export-"+attempt);
const view=(r:WorkspaceExport)=>({id:r.id,status:r.status,attempts:r.attempts,createdAt:r.createdAt.toISOString(),
  expiresAt:r.expiresAt.toISOString(),snapshotAt:r.snapshotAt?.toISOString()??null,size:r.size,
  counts:r.counts,errorCode:r.errorCode,notice:WORKSPACE_EXPORT_NOTICE});
async function owned(tx:Tx,actor:WorkspaceActor,id:string,lock=false){
  let q=tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.workspaceId,actor.workspaceId),eq(jobs.requesterId,actor.identityId)));
  const[row]=await(lock?q.for("update"):q);
  if(!row)throw new ValoProblem(404,"Workspace export not found.");
  await authorizeWorkspaceRead(tx,actor);return row;
}
export async function listWorkspaceExports(actor:WorkspaceActor){
  return db.transaction(async tx=>{await authorizeWorkspaceRead(tx,actor);
    return(await tx.select().from(jobs).where(and(eq(jobs.workspaceId,actor.workspaceId),eq(jobs.requesterId,actor.identityId)))
      .orderBy(desc(jobs.createdAt)).limit(10)).map(view);});
}
export async function createWorkspaceExport(actor:WorkspaceActor,requestKey:string){
  return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actor.workspaceId+"workspace-export"},0))`);
    await authorizeWorkspaceRead(tx,actor);
    const[old]=await tx.select().from(jobs).where(and(eq(jobs.workspaceId,actor.workspaceId),eq(jobs.requesterId,actor.identityId),eq(jobs.requestKey,requestKey)));
    if(old)return view(old);
    await tx.update(jobs).set({status:"expired"}).where(and(eq(jobs.workspaceId,actor.workspaceId),lt(jobs.expiresAt,new Date())));
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
export async function cancelWorkspaceExport(actor:WorkspaceActor,id:string){
  return db.transaction(async tx=>{const job=await owned(tx,actor,id,true);
    await authorizeWorkspaceWrite(tx,actor);
    await tx.update(jobs).set({status:"cancelled",leaseUntil:null,updatedAt:new Date()}).where(eq(jobs.id,id));
    await tx.update(attempts).set({status:"cleanup"}).where(eq(attempts.jobId,id));
    return view({...job,status:"cancelled"});});
}
async function current(actor:WorkspaceActor,id:string,attemptId:string){
  return db.transaction(async tx=>{
    const row=await owned(tx,actor,id);
    if(row.currentAttemptId!==attemptId||row.status!=="preparing"||row.expiresAt.getTime()<=Date.now())
      throw new ValoProblem(409,"This preparation was cancelled, superseded or expired.");
    await authorizeWorkspaceWrite(tx,actor);
    await tx.update(jobs).set({leaseUntil:new Date(Date.now()+15000),updatedAt:new Date()})
      .where(and(eq(jobs.id,id),eq(jobs.currentAttemptId,attemptId),eq(jobs.status,"preparing")));
  });
}
/** One stable job, fresh immutable object and whole fixed snapshot per attempt.
 * No in-memory queue or retained membership lock. A crashed lease is reclaimable. */
export async function prepareWorkspaceExport(actor:WorkspaceActor,id:string,signal:AbortSignal,verify:()=>Promise<void>,
  storage:WorkspaceExportStorage=workspaceExportStorage,onPage?:(section:string,rows:number)=>Promise<void>){
  await abortable(signal,verify);
  const claim=await db.transaction(async tx=>{
    const old=await owned(tx,actor,id,true);
    if(old.expiresAt.getTime()<=Date.now()||["cancelled","expired"].includes(old.status))throw new ValoProblem(410,"This prepared export has expired or was discarded. Request a new snapshot.");
    if(old.status==="ready")return null;
    if(old.status==="preparing"&&old.leaseUntil&&old.leaseUntil.getTime()>Date.now())
      throw new ValoProblem(409,"Preparation is active. Retry after its current lease ends.",undefined,15);
    if(old.attempts>=5)throw new ValoProblem(409,"Five attempts were used. Discard this job and request a new snapshot; no partial result is ready.");
    await tx.update(attempts).set({status:"cleanup"}).where(eq(attempts.jobId,id));
    signal.throwIfAborted();await authorizeWorkspaceWrite(tx,actor);
    const attemptId=randomUUID(),key=`valo/development/${actor.workspaceId}/${attemptId}.json`;
    await tx.insert(attempts).values({id:attemptId,jobId:id,workspaceId:actor.workspaceId,objectKey:key});
    await tx.update(jobs).set({status:"preparing",attempts:old.attempts+1,currentAttemptId:attemptId,
      leaseUntil:new Date(Date.now()+15000),errorCode:null,updatedAt:new Date()}).where(eq(jobs.id,id));
    return{attemptId,key};
  });
  if(!claim)return;
  const directory=workspaceExportScratch(claim.attemptId),path=join(directory,"workspace.json");
  let upload:Promise<void>|undefined;
  try{
    await mkdir(directory,{mode:0o700});
    const file=await open(path,"wx",0o600);
    let snapshot:Awaited<ReturnType<typeof workspaceDataExport>>;
    try{
      snapshot=await workspaceDataExport(actor,async chunk=>{signal.throwIfAborted();await file.writeFile(chunk,"utf8");},signal,
        async(section,rows)=>{await abortable(signal,verify);await current(actor,id,claim.attemptId);await onPage?.(section,rows);});
    }finally{await file.close();}
    const proof=await workspaceFileDigest(path,signal);
    await current(actor,id,claim.attemptId);await abortable(signal,verify);
    await db.update(attempts).set({status:"uploading"}).where(eq(attempts.id,claim.attemptId));
    upload=storage.put(claim.key,path,signal);
    // Keep a cleanup reservation even if the SDK reports success after abort.
    void upload.then(async()=>{if(signal.aborted)await storage.remove(claim.key);},()=>{}).catch(()=>{});
    await abortable(signal,()=>upload!);
    const verification=join(directory,"verified.json");
    await abortable(signal,()=>storage.get(claim.key,verification,signal));
    const verified=await workspaceFileDigest(verification,signal);
    if(proof.checksum!==verified.checksum||proof.size!==verified.size)throw Error("PRIVATE_OBJECT_VERIFICATION_FAILED");
    await abortable(signal,verify);signal.throwIfAborted();
    await db.transaction(async tx=>{
      const row=await owned(tx,actor,id,true);signal.throwIfAborted();
      await authorizeWorkspaceWrite(tx,actor);
      if(row.currentAttemptId!==claim.attemptId||row.status!=="preparing")throw new ValoProblem(409,"Preparation was superseded.");
      await tx.update(attempts).set({status:"ready"}).where(eq(attempts.id,claim.attemptId));
      await tx.update(jobs).set({status:"ready",leaseUntil:null,...proof,counts:snapshot.counts,scope:snapshot.scope,
        snapshotAt:new Date(snapshot.exportedAt),updatedAt:new Date()}).where(eq(jobs.id,id));
    });
  }catch(error){
    // Local material must not wait behind a slow remote delete. The reserved
    // object key remains in the durable cleanup rotation, including late puts.
    await rm(directory,{recursive:true,force:true});
    await db.transaction(async tx=>{
      await tx.update(attempts).set({status:"cleanup"}).where(eq(attempts.id,claim.attemptId));
      await tx.update(jobs).set({status:"interrupted",leaseUntil:null,errorCode:signal.aborted?"REQUEST_INTERRUPTED":"PREPARATION_NOT_RELEASED",updatedAt:new Date()})
        .where(and(eq(jobs.id,id),eq(jobs.currentAttemptId,claim.attemptId),eq(jobs.status,"preparing")));
    });
    try{await abortable(AbortSignal.timeout(750),()=>storage.remove(claim.key));}catch{/* Durable cleanup remains pending. */}
    throw error;
  }finally{await rm(directory,{recursive:true,force:true});}
}
/** Download only verified complete private artifacts; session and membership are
 * re-read after object retrieval too. Returning a result is not receipt proof. */
export async function withPreparedWorkspaceExport<T>(actor:WorkspaceActor,id:string,signal:AbortSignal,
  verify:()=>Promise<void>,consume:(path:string,proof:{size:number;checksum:string})=>Promise<T>,
  storage:WorkspaceExportStorage=workspaceExportStorage){
  await abortable(signal,verify);
  const result=await db.transaction(async tx=>{
    const row=await owned(tx,actor,id);
    if(row.status!=="ready"||row.expiresAt.getTime()<=Date.now()||!row.currentAttemptId||!row.checksum||row.size===null)
      throw new ValoProblem(409,"No complete unexpired artifact is available.");
    const[attempt]=await tx.select().from(attempts).where(and(eq(attempts.id,row.currentAttemptId),eq(attempts.jobId,id),
      eq(attempts.workspaceId,actor.workspaceId),eq(attempts.status,"ready")));
    if(!attempt)throw new ValoProblem(409,"Private artifact verification is unavailable.");
    return{row,key:attempt.objectKey};
  });
  const directory=await mkdtemp(join(tmpdir(),"valo-data-result-")),path=join(directory,"workspace.json");
  try{
    await abortable(signal,()=>storage.get(result.key,path,signal));
    const proof=await workspaceFileDigest(path,signal);
    if(proof.checksum!==result.row.checksum||proof.size!==result.row.size)throw new ValoProblem(409,"Private result integrity check failed. No bytes were released.");
    await abortable(signal,verify);
    await db.transaction(async tx=>{
      const row=await owned(tx,actor,id);signal.throwIfAborted();
      if(row.status!=="ready"||row.currentAttemptId!==result.row.currentAttemptId||row.expiresAt.getTime()<=Date.now())
        throw new ValoProblem(409,"Result access changed during retrieval.");
    });
    return await consume(path,proof);
  }finally{await rm(directory,{force:true,recursive:true});}
}
export async function retireWorkspaceExports(tx:Tx,workspaceId:string){
  const changed=await tx.update(jobs).set({status:"cancelled",leaseUntil:null,updatedAt:new Date()})
    .where(and(eq(jobs.workspaceId,workspaceId),sql`${jobs.status}<>'cancelled'`)).returning();
  await tx.update(attempts).set({status:"cleanup"}).where(eq(attempts.workspaceId,workspaceId));
  return{rowCount:changed.length};
}
export async function cleanupWorkspaceExports(storage:WorkspaceExportStorage=workspaceExportStorage,workspaceId?:string){
  await db.update(jobs).set({status:"interrupted",leaseUntil:null,errorCode:"ABANDONED_PREPARATION"})
    .where(and(eq(jobs.status,"preparing"),lt(jobs.leaseUntil,new Date()),workspaceId?eq(jobs.workspaceId,workspaceId):undefined));
  await db.update(jobs).set({status:"expired"}).where(and(lt(jobs.expiresAt,new Date()),workspaceId?eq(jobs.workspaceId,workspaceId):undefined));
  const rows=await db.select({a:attempts,j:jobs}).from(attempts).innerJoin(jobs,eq(attempts.jobId,jobs.id))
    .where(and(sql`(${attempts.status}='cleanup' OR ${jobs.status} IN ('interrupted','cancelled','expired'))`,
      workspaceId?eq(attempts.workspaceId,workspaceId):undefined))
    .orderBy(sql`${attempts.cleanupCheckedAt} ASC NULLS FIRST`,attempts.id).limit(5);
  let failed=0,privacyHeld=0;
  for(const{a}of rows){
    const[erasure]=await db.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones)
      .where(eq(valoPrivacyTombstones.workspaceId,a.workspaceId)).limit(1);
    // Privacy-owned bytes and scratch copies may only pass the authenticated
    // erasure replay. Ordinary expiry cannot bypass a hold or missing keys.
    if(erasure){
      privacyHeld++;
      await db.update(attempts).set({cleanupCheckedAt:new Date()}).where(eq(attempts.id,a.id));
      continue;
    }
    try{await abortable(AbortSignal.timeout(1500),()=>storage.remove(a.objectKey));
      await rm(workspaceExportScratch(a.id),{force:true,recursive:true});}
    catch{failed++;}finally{await db.update(attempts).set({cleanupCheckedAt:new Date()}).where(eq(attempts.id,a.id));}}
  return{checked:rows.length,failed,privacyHeld};
}
