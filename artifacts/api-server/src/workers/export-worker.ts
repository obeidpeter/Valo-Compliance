import { z } from "zod";
import {closePrivacyErasureLocks} from "../lib/valo-privacy-erasure";
import { db, pool, valoExportJobs } from "@workspace/db";
import { eq } from "drizzle-orm";
import { exportQueue, EXPORT_QUEUE } from "../lib/valo-export-queue";
import { executeExport, developmentExportsOnly } from "../lib/valo-exports";
import { logger } from "../lib/logger";
import { reconcileDueReminders } from "../lib/valo-reminder-worker";
import { recoverAbandonedExports,reconcileExportOrphans } from "../lib/valo-export-recovery";
import { processPaymentEvents,reconcilePayments } from "../lib/valo-commerce";
import {processRefundQueue} from "../lib/valo-refunds";
import {reconcileKnownDisputes} from "../lib/valo-payment-disputes";
import {dispatchOperationalJobs} from "../lib/valo-operational-dispatch";
import {assertRecoveryEffectsAllowed} from "../lib/valo-recovery-effects";
import {recordWorkerHeartbeat,collectOperationalSample,recordOperationalAlerts} from "../lib/valo-operations";

developmentExportsOnly();
assertRecoveryEffectsAllowed();
const payload = z.object({ jobId:z.string().uuid(),workspaceId:z.string().uuid() }).strict();
const boss = exportQueue();
boss.on("error", () => logger.error({event:"queue.database_error"}));
await boss.start();
await boss.work(EXPORT_QUEUE, {batchSize:1,pollingIntervalSeconds:1}, async jobs => {
  for (const entry of jobs) {
    const input = payload.parse(entry.data);
    const faultHarness=process.env.NODE_ENV==="development"&&!process.env.REPLIT_DEPLOYMENT&&
      process.env.VALO_RUN_EXPORT_CRASH_TESTS==="synthetic-development-only"&&process.send&&
      process.env.VALO_EXPORT_CRASH_JOB===input.jobId;
    await executeExport(input.jobId,input.workspaceId,entry.id,faultHarness?async stage=>{
      if(stage!==process.env.VALO_EXPORT_CRASH_STAGE)return;
      const [owned]=await db.select().from(valoExportJobs).where(eq(valoExportJobs.id,input.jobId));
      if(!owned?.requestedBy.startsWith("synthetic-export-crash-"))throw Error("OWNED_SYNTHETIC_JOB_REQUIRED");
      process.send!({stage});await new Promise<void>(resolve=>process.once("message",()=>resolve()));
    }:undefined);
  }
});
let dispatching = false;
let dispatchIdle:Promise<void>=Promise.resolve();
let reminderCheckedAt=0;
let operationalCheckedAt=0;
async function dispatch() {
  developmentExportsOnly();
  if (dispatching) return;
  dispatching = true;
  let finishDispatch!:()=>void;dispatchIdle=new Promise(resolve=>{finishDispatch=resolve;});
  try {
    try{
    await recoverAbandonedExports();
    const cleanup=await reconcileExportOrphans();
    if(cleanup.failed)logger.error({event:"export.orphan_cleanup_failed",count:cleanup.failed});
    if(cleanup.privacyHeld)logger.error({event:"privacy.erasure_replay_held",count:cleanup.privacyHeld});
    // This durable table is the transactional outbox. Stable queue IDs make retries harmless.
    const pending = await db.select().from(valoExportJobs).where(eq(valoExportJobs.status,"queued")).limit(25);
    for (const job of pending)
      await boss.send(EXPORT_QUEUE, {jobId:job.id,workspaceId:job.workspaceId},{id:job.queueId});
    }catch{logger.error({event:"export.dispatch_failed"});}
    if(Date.now()-reminderCheckedAt>=60000){
      reminderCheckedAt=Date.now();
      const failures=await dispatchOperationalJobs({reminders:()=>reconcileDueReminders(),
        paymentEvents:()=>processPaymentEvents(),refunds:()=>processRefundQueue(),
        disputes:()=>reconcileKnownDisputes(),paymentReconciliation:()=>reconcilePayments()});
      for(const domain of failures)logger.error({event:"operational.dispatch_failed",domain});
    }
  } catch { logger.error({event:"export.dispatch_failed"}); }
  finally {
    try{
      await recordWorkerHeartbeat();
      if(Date.now()-operationalCheckedAt>=60000){
        operationalCheckedAt=Date.now();
        await recordOperationalAlerts(await collectOperationalSample(text=>{const config={text,query_timeout:1500};return pool.query(config);}));
      }
    }catch{logger.error({event:"operations.internal_probe_failed"});}
    dispatching=false;finishDispatch();
  }
}
await dispatch();
const timer = setInterval(dispatch,3000);
logger.info({event:"export.worker_ready",mode:"synthetic-development-only"});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await boss.stop({graceful:true,timeout:60000});
  await dispatchIdle;
  await closePrivacyErasureLocks();
  await pool.end();
}
process.on("SIGTERM",()=>{void stop();});
process.on("SIGINT",()=>{void stop();});
