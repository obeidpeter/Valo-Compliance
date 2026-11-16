import {randomUUID} from "node:crypto";
import {and,eq,inArray,lte,sql} from "drizzle-orm";
import {db,valoExportJobs,valoExportObjects,valoFileAssets,valoEvents,valoPrivacyTombstones} from "@workspace/db";
import {assertRuntimeObjectScope} from "./valo-runtime-activation";
import {deletePrivateFile} from "./valo-private-storage";
import {privateCleanupAuthority} from "./valo-private-cleanup-authority";
import {assertApplicationRuntime} from "./valo-runtime-activation";

export const EXPORT_LEASE_MS=90_000;
export const EXPORT_HEARTBEAT_MS=10_000;

/** Application leases are independent of pg-boss retry/retention state.
 * Rotate the generation before redispatch, fencing every prior worker.
 */
export async function recoverAbandonedExports(jobId?:string){
  assertApplicationRuntime();
  return db.transaction(async tx=>{
    const due=await tx.select().from(valoExportJobs).where(and(
      inArray(valoExportJobs.status,["queued","running","retrying"]),
      lte(valoExportJobs.updatedAt,new Date(Date.now()-EXPORT_LEASE_MS)),
      jobId?eq(valoExportJobs.id,jobId):undefined,
    )).limit(25).for("update",{skipLocked:true});
    for(const job of due){
      const exhausted=job.attempts>=3||job.leaseRecoveries>=2;
      await tx.update(valoExportJobs).set({status:exhausted?"failed":"queued",queueId:randomUUID(),
        leaseRecoveries:job.leaseRecoveries+1,errorCode:"EXPORT_WORKER_INTERRUPTED",updatedAt:new Date()}).where(eq(valoExportJobs.id,job.id));
      await tx.update(valoExportObjects).set({state:"cleanup",nextCleanupAt:new Date()})
        .where(and(eq(valoExportObjects.jobId,job.id),eq(valoExportObjects.state,"pending")));
      await tx.insert(valoEvents).values({id:randomUUID(),workspaceId:job.workspaceId,actorId:"service:export-recovery",
        action:exhausted?"export.abandoned_failed":"export.recovered",entityId:job.id,revision:job.revision});
    }
    return due.length;
  });
}

/** Bounded batches, persisted backoff and retained tombstones. Re-delete hourly
 * after success so an upload accepted before process death cannot resurrect an
 * untracked object after an earlier ignore-not-found deletion.
 */
export async function reconcileExportOrphans(jobId?:string,remove:(key:string)=>Promise<void>=deletePrivateFile,
  scope?:{workspaceId:string;caseId:string}){
  assertApplicationRuntime();
  if(scope){
    const [bound]=await db.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones).where(and(
      eq(valoPrivacyTombstones.caseId,scope.caseId),eq(valoPrivacyTombstones.workspaceId,scope.workspaceId))).limit(1);
    if(!bound)throw Error("ERASURE_RECONCILIATION_SCOPE_MISMATCH");
  }
  const due=await db.select().from(valoExportObjects).where(and(eq(valoExportObjects.state,"cleanup"),
    lte(valoExportObjects.nextCleanupAt,new Date()),jobId?eq(valoExportObjects.jobId,jobId):undefined,
    scope?eq(valoExportObjects.workspaceId,scope.workspaceId):undefined)).limit(25);
  let cleaned=0,failed=0,privacyHeld=0;
  for(const object of due){
    await db.transaction(async tx=>{
      if(!(await privateCleanupAuthority(tx,object.workspaceId)).allowed){privacyHeld++;return;}
      const [locked]=await tx.select().from(valoExportObjects).where(and(eq(valoExportObjects.objectKey,object.objectKey),
        eq(valoExportObjects.state,"cleanup"),lte(valoExportObjects.nextCleanupAt,new Date()))).for("update",{skipLocked:true});
      if(!locked)return;
      try{assertRuntimeObjectScope(locked.workspaceId,locked.objectKey);}catch{
        failed++;await tx.update(valoExportObjects).set({nextCleanupAt:new Date(Date.now()+60_000)})
          .where(eq(valoExportObjects.objectKey,locked.objectKey));return;
      }
      const[erasure]=await tx.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones)
        .where(eq(valoPrivacyTombstones.workspaceId,locked.workspaceId)).limit(1);
      if(erasure){
        // Once privacy owns this scope, ordinary orphan cleanup must not
        // bypass a hold, incomplete case or signed-inventory validation.
        privacyHeld++;
        await tx.update(valoExportObjects).set({nextCleanupAt:new Date(Date.now()+60_000)})
          .where(eq(valoExportObjects.objectKey,object.objectKey));
        return;
      }
      const [asset]=await tx.select().from(valoFileAssets).where(eq(valoFileAssets.objectKey,object.objectKey)).limit(1);
      if(asset){await tx.update(valoExportObjects).set({state:"retained"}).where(eq(valoExportObjects.objectKey,object.objectKey));return;}
      let delay=3_600_000;
      try{await remove(object.objectKey);cleaned++;}
      catch{failed++;delay=Math.min(3_600_000,30_000*2**Math.min(7,object.cleanupAttempts));}
      await tx.update(valoExportObjects).set({cleanupAttempts:sql`${valoExportObjects.cleanupAttempts}+1`,
        nextCleanupAt:new Date(Date.now()+delay)}).where(eq(valoExportObjects.objectKey,object.objectKey));
    });
  }
  // Completed privacy journals outlive the export-job FK chain. They must be
  // revisited by the same running worker, including after a killed uploader.
  if(!jobId&&process.env.NODE_ENV!=="production"){
    const {reconcileErasedObjects}=await import("./valo-privacy-erasure");
    const erased=await reconcileErasedObjects(remove,scope?.caseId);
    return{cleaned:cleaned+erased.cleaned,failed:failed+erased.failed,privacyHeld:privacyHeld+erased.held};
  }
  return{cleaned,failed,privacyHeld};
}
