import { initializeApplicationRuntime, verifyRehearsalDatabase } from "../lib/valo-runtime-activation";
import { z } from "zod";
import { closePrivacyErasureLocks } from "../lib/valo-privacy-erasure";
import { db, pool, valoExportJobs } from "@workspace/db";
import { eq } from "drizzle-orm";
import { exportQueue, EXPORT_QUEUE } from "../lib/valo-export-queue";
import { executeExport, developmentExportsOnly } from "../lib/valo-exports";
import { logger } from "../lib/logger";
import { reconcileDueReminders } from "../lib/valo-reminder-worker";
import { recoverAbandonedExports, reconcileExportOrphans } from "../lib/valo-export-recovery";
import { expireGeneratedExports } from "../lib/valo-export-retention";
import { processPaymentEvents, reconcilePayments } from "../lib/valo-commerce";
import { processRefundQueue } from "../lib/valo-refunds";
import { reconcileDisputeActions } from "../lib/valo-dispute-actions";
import { reconcileKnownDisputes } from "../lib/valo-payment-disputes";
import { dispatchOperationalJobs } from "../lib/valo-operational-dispatch";
import { assertRecoveryEffectsAllowed } from "../lib/valo-recovery-effects";
import {
  cleanupWorkspaceExports,
  pendingWorkspaceExports,
  executeWorkspaceExport,
  WORKSPACE_EXPORT_QUEUE,
} from "../lib/valo-workspace-export-jobs";
import {
  recordWorkerHeartbeat,
  collectOperationalSample,
  recordOperationalAlerts,
} from "../lib/valo-operations";
import { WorkerHealth, workerHealthServer, drainWithDeadline } from "../lib/valo-worker-health";
import { environment, setting } from "../platform/settings";

await initializeApplicationRuntime();
developmentExportsOnly();
assertRecoveryEffectsAllowed();
const payload = z.object({ jobId: z.string().uuid(), workspaceId: z.string().uuid() }).strict();
const boss = exportQueue();
const health = new WorkerHealth();
let heartbeatWrite = Promise.resolve();
const heartbeatPublishFailed = () => logger.warn({ event: "worker.heartbeat_publish_failed" });
function publishHeartbeat() {
  const snapshot = health.snapshot(),
    next = heartbeatWrite.then(() => recordWorkerHeartbeat(snapshot));
  const published = next.then(() => {
    if (setting("VALO_SUPERVISED_WORKER") === "ipc-v1" && process.connected && process.send)
      process.send({ type: "valo.worker.health", heartbeat: snapshot }, () => {});
  });
  // Keeps later heartbeats serialised after a failed write; callers receive the failure via `published`.
  heartbeatWrite = published.catch(() => {});
  return published;
}
boss.on("error", () => {
  health.fail();
  logger.error({ event: "queue.database_error" });
  void publishHeartbeat().catch(heartbeatPublishFailed);
});
let timer: ReturnType<typeof setInterval> | undefined;
let dispatching = false;
let dispatchIdle: Promise<void> = Promise.resolve();
let startup: Promise<void> = Promise.resolve();
let healthServer: Awaited<ReturnType<typeof workerHealthServer>> | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  health.drain();
  clearInterval(timer);
  await drainWithDeadline(async () => {
    await publishHeartbeat().catch(heartbeatPublishFailed);
    // Startup failures are already logged as export.startup_failed.
    await startup.catch(() => {});
    await Promise.all([boss.stop({ graceful: true, timeout: 60000 }), dispatchIdle]);
    await closePrivacyErasureLocks();
    await pool.end();
    if (healthServer)
      await new Promise<void>((resolve, reject) => healthServer!.close((e) => (e ? reject(e) : resolve())));
    if (setting("VALO_SUPERVISED_WORKER") === "ipc-v1" && process.connected) process.disconnect?.();
  });
}
const shutdown = () => {
  void stop().catch(() => {
    logger.error({ event: "export.shutdown_failed" });
    process.exit(1);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// Loss of the supervisor must not leave an unmanaged worker processing jobs.
if (setting("VALO_SUPERVISED_WORKER") === "ipc-v1") {
  if (!process.send) throw Error("WORKER_SUPERVISOR_IPC_REQUIRED");
  process.once("disconnect", shutdown);
}
startup = (async () => {
  const healthPort = setting("VALO_WORKER_HEALTH_PORT");
  if (healthPort !== undefined) {
    if (healthPort.trim() !== healthPort || !/^[1-9][0-9]{0,4}$/.test(healthPort))
      throw Error("INVALID_WORKER_HEALTH_PORT");
    healthServer = await workerHealthServer(health, Number(healthPort));
  }
  await publishHeartbeat();
  await boss.start();
  if (stopping) return;
  await boss.work(EXPORT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const entry of jobs) {
      const input = payload.parse(entry.data);
      const faultHarness =
        setting("NODE_ENV") === "development" &&
        !setting("REPLIT_DEPLOYMENT") &&
        setting("VALO_RUN_EXPORT_CRASH_TESTS") === "synthetic-development-only" &&
        process.send &&
        setting("VALO_EXPORT_CRASH_JOB") === input.jobId;
      await executeExport(
        input.jobId,
        input.workspaceId,
        entry.id,
        faultHarness
          ? async (stage) => {
              if (stage !== setting("VALO_EXPORT_CRASH_STAGE")) return;
              const [owned] = await db
                .select()
                .from(valoExportJobs)
                .where(eq(valoExportJobs.id, input.jobId));
              if (!owned?.requestedBy.startsWith("synthetic-export-crash-"))
                throw Error("OWNED_SYNTHETIC_JOB_REQUIRED");
              process.send!({ stage });
              await new Promise<void>((resolve) => process.once("message", () => resolve()));
            }
          : undefined,
      );
    }
  });
  await boss.work(WORKSPACE_EXPORT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async (entries) => {
    for (const entry of entries) {
      const input = payload.parse(entry.data);
      await executeWorkspaceExport(input.jobId, input.workspaceId, entry.id);
    }
  });
})();
let reminderCheckedAt = 0;
let operationalCheckedAt = 0;
let operationalDispatchHealthy = true;
async function dispatch() {
  developmentExportsOnly();
  if (dispatching) return;
  const started = health.begin();
  if (started === null) return;
  dispatching = true;
  let succeeded = false;
  let finishDispatch!: () => void;
  dispatchIdle = new Promise((resolve) => {
    finishDispatch = resolve;
  });
  try {
    if (setting("NODE_ENV") === "production")
      await verifyRehearsalDatabase((sql) => {
        const query = { text: sql, query_timeout: 1500 };
        return pool.query(query);
      }, environment());
    // An idle queue must still prove that both configured queues are reachable.
    const queueQuery = {
      text: "SELECT name,retry_limit,expire_seconds FROM valo_jobs.queue WHERE name=ANY($1::text[])",
      values: [[EXPORT_QUEUE, WORKSPACE_EXPORT_QUEUE]],
      query_timeout: 1500,
    };
    const queues = await pool.query(queueQuery);
    if (
      queues.rows.length !== 2 ||
      !queues.rows.some((q) => q.name === EXPORT_QUEUE && q.retry_limit === 2 && q.expire_seconds === 120) ||
      !queues.rows.some(
        (q) => q.name === WORKSPACE_EXPORT_QUEUE && q.retry_limit === 0 && q.expire_seconds === 360,
      )
    )
      throw Error("WORKER_QUEUE_CONFIGURATION_INVALID");
    await recoverAbandonedExports();
    const retention = await expireGeneratedExports();
    if (retention.failed) logger.error({ event: "export.retention_binding_failed", count: retention.failed });
    const cleanup = await reconcileExportOrphans();
    if (cleanup.failed) logger.error({ event: "export.orphan_cleanup_failed", count: cleanup.failed });
    if (cleanup.privacyHeld)
      logger.error({ event: "privacy.erasure_replay_held", count: cleanup.privacyHeld });
    try {
      const privateData = await cleanupWorkspaceExports();
      if (privateData.failed)
        logger.error({ event: "workspace_export.cleanup_pending", count: privateData.failed });
    } catch (error) {
      logger.error({ event: "workspace_export.cleanup_failed", err: error });
    }
    for (const job of await pendingWorkspaceExports()) {
      if (stopping) break;
      await boss.send(
        WORKSPACE_EXPORT_QUEUE,
        { jobId: job.id, workspaceId: job.workspaceId },
        { id: job.queueId },
      );
    }
    // This durable table is the transactional outbox. Stable queue IDs make retries harmless.
    const pending = await db
      .select()
      .from(valoExportJobs)
      .where(eq(valoExportJobs.status, "queued"))
      .limit(25);
    for (const job of pending) {
      if (stopping) break;
      await boss.send(EXPORT_QUEUE, { jobId: job.id, workspaceId: job.workspaceId }, { id: job.queueId });
    }
    if (setting("NODE_ENV") !== "production" && !stopping && Date.now() - reminderCheckedAt >= 60000) {
      reminderCheckedAt = Date.now();
      const failures = await dispatchOperationalJobs({
        reminders: () => reconcileDueReminders(),
        paymentEvents: () => processPaymentEvents(),
        refunds: () => processRefundQueue(),
        disputes: () => reconcileKnownDisputes(),
        disputeActions: () => reconcileDisputeActions(),
        paymentReconciliation: () => reconcilePayments(),
      });
      for (const domain of failures) logger.error({ event: "operational.dispatch_failed", domain });
      operationalDispatchHealthy = failures.length === 0;
    }
    succeeded = operationalDispatchHealthy;
  } catch (error) {
    logger.error({ event: "export.dispatch_failed", err: error });
  } finally {
    health.finish(started, succeeded);
    try {
      await publishHeartbeat();
      if (!stopping && Date.now() - operationalCheckedAt >= 60000) {
        operationalCheckedAt = Date.now();
        const sample = await collectOperationalSample((text) => {
          const config = { text, query_timeout: 1500 };
          return pool.query(config);
        });
        const alerts = await recordOperationalAlerts(sample);
        if (setting("VALO_SUPERVISED_WORKER") === "ipc-v1" && process.connected && process.send)
          process.send(
            {
              type: "valo.worker.operations",
              healthy: alerts.active.length === 0,
              checkedAt: sample.checkedAt,
            },
            () => {},
          );
      }
    } catch (error) {
      health.fail();
      logger.error({ event: "operations.internal_probe_failed", err: error });
      await publishHeartbeat().catch(heartbeatPublishFailed);
    }
    dispatching = false;
    finishDispatch();
  }
}
try {
  await startup;
  if (!stopping) {
    await dispatch();
    if (!stopping)
      timer = setInterval(() => {
        void dispatch().catch(() => {
          health.fail();
          void publishHeartbeat().catch(heartbeatPublishFailed);
        });
      }, 3000);
  }
  if (!stopping) logger.info({ event: "export.worker_started", mode: "synthetic-development-only" });
} catch (error) {
  health.fail();
  logger.error({ event: "export.startup_failed", err: error });
  process.exitCode = 1;
  await stop();
}
