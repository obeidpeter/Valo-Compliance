import {randomUUID} from "node:crypto";
import {and,eq,inArray,lte,sql} from "drizzle-orm";
import {db,valoExportJobs,valoExportObjects,valoFileAssets,valoEvents} from "@workspace/db";
import {assertApplicationRuntime,assertRuntimeObjectScope,runtimeEnvironment} from "./valo-runtime-activation";
import {privateCleanupAuthority} from "./valo-private-cleanup-authority";

type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Job=typeof valoExportJobs.$inferSelect;
type Asset=typeof valoFileAssets.$inferSelect;
export const EXPORT_EXPIRED="EXPORT_EXPIRED";
export function exportRetentionAt(now=new Date(),env:Record<string,string|undefined>=process.env){
  const value=env.VALO_EXPORT_RETENTION_DAYS??"30";
  if(!/^[1-9][0-9]{0,2}$/.test(value)||Number(value)>365)throw Error("INVALID_EXPORT_RETENTION_DAYS");
  return new Date(now.getTime()+Number(value)*86_400_000);
}
export const exportIsExpired=(asset:Pick<Asset,"retentionAt">|null|undefined,now=Date.now())=>
  !!asset?.retentionAt&&asset.retentionAt.getTime()<=now;

/** Caller owns privacy-case locks, then the job lock. Detach only regenerable
 * bytes, retaining the immutable draft, job, request aliases and cleanup journal.
 * The existing privacy-aware orphan worker performs/retries physical deletion. */
export async function retireExpiredExport(tx:Tx,job:Job,asset:Asset){
  if(job.status!=="ready"||!exportIsExpired(asset))return false;
  try{assertRuntimeObjectScope(job.workspaceId,asset.objectKey);}catch{throw Error("EXPORT_RETENTION_BINDING_INVALID");}
  if(asset.jobId!==job.id||asset.workspaceId!==job.workspaceId||
    asset.objectKey!==`valo/${runtimeEnvironment()}/${job.workspaceId}/${asset.id}.${job.format}`)
    throw Error("EXPORT_RETENTION_BINDING_INVALID");
  const [object]=await tx.select().from(valoExportObjects).where(eq(valoExportObjects.objectKey,asset.objectKey)).for("update");
  if(!object||object.state!=="retained"||object.jobId!==job.id||object.workspaceId!==job.workspaceId||object.queueId!==job.queueId)
    throw Error("EXPORT_RETENTION_BINDING_INVALID");
  await tx.update(valoExportObjects).set({state:"cleanup",nextCleanupAt:new Date()}).where(eq(valoExportObjects.objectKey,object.objectKey));
  await tx.delete(valoFileAssets).where(eq(valoFileAssets.id,asset.id));
  await tx.update(valoExportJobs).set({status:"failed",errorCode:EXPORT_EXPIRED,queueId:randomUUID(),updatedAt:new Date()})
    .where(eq(valoExportJobs.id,job.id));
  await tx.insert(valoEvents).values({id:randomUUID(),workspaceId:job.workspaceId,actorId:"service:export-retention",
    action:"export.expired",entityId:job.id,revision:job.revision});
  return true;
}

export async function expireGeneratedExports(workspaceId?:string){
  assertApplicationRuntime();
  // Reserve a retry window, then release object locks before privacy authority.
  const candidates=await db.transaction(async tx=>{
    const due=await tx.select({object:valoExportObjects}).from(valoFileAssets)
      .innerJoin(valoExportJobs,and(eq(valoFileAssets.jobId,valoExportJobs.id),eq(valoFileAssets.workspaceId,valoExportJobs.workspaceId)))
      .innerJoin(valoExportObjects,and(eq(valoExportObjects.objectKey,valoFileAssets.objectKey),eq(valoExportObjects.jobId,valoExportJobs.id),eq(valoExportObjects.workspaceId,valoExportJobs.workspaceId)))
      .where(and(eq(valoExportJobs.status,"ready"),lte(valoFileAssets.retentionAt,new Date()),
        eq(valoExportObjects.state,"retained"),lte(valoExportObjects.nextCleanupAt,new Date()),
        workspaceId?eq(valoExportJobs.workspaceId,workspaceId):undefined))
      .orderBy(valoFileAssets.retentionAt,valoFileAssets.id).limit(5).for("update",{of:valoExportObjects,skipLocked:true});
    if(due.length)await tx.update(valoExportObjects).set({nextCleanupAt:new Date(Date.now()+60_000)})
      .where(inArray(valoExportObjects.objectKey,due.map(row=>row.object.objectKey)));
    return due;
  });
  let expired=0,held=0,failed=0;
  for(const {object} of candidates)await db.transaction(async tx=>{
    await tx.execute(sql`set local lock_timeout='1000ms'`);
    const authority=await privateCleanupAuthority(tx,object.workspaceId);
    if(!authority.allowed){
      held++;await tx.update(valoExportObjects).set({nextCleanupAt:new Date(Date.now()+3_600_000)})
        .where(and(eq(valoExportObjects.objectKey,object.objectKey),eq(valoExportObjects.state,"retained")));return;
    }
    const [job]=await tx.select().from(valoExportJobs).where(and(eq(valoExportJobs.id,object.jobId),eq(valoExportJobs.workspaceId,object.workspaceId)))
      .for("update",{skipLocked:true});
    if(!job||job.status!=="ready")return;
    const [asset]=await tx.select().from(valoFileAssets).where(and(eq(valoFileAssets.jobId,job.id),eq(valoFileAssets.objectKey,object.objectKey))).for("update");
    if(!asset||!exportIsExpired(asset))return;
    try{if(await retireExpiredExport(tx,job,asset))expired++;}
    catch(error){
      if(!(error instanceof Error)||error.message!=="EXPORT_RETENTION_BINDING_INVALID")throw error;
      failed++;await tx.update(valoExportObjects).set({nextCleanupAt:new Date(Date.now()+3_600_000)})
        .where(eq(valoExportObjects.objectKey,object.objectKey));
    }
  });
  return{checked:candidates.length,expired,held,failed};
}
