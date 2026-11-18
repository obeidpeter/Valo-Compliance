import { initializeApplicationRuntime, verifyRehearsalDatabase } from "../lib/valo-runtime-activation";
import { reconcileSourceMonitoring } from "../lib/valo-source-monitor";
import { z } from "zod";
import { closePrivacyErasureLocks } from "../lib/valo-privacy-erasure";
import { db, pool, valoExportJobs } from "@workspace/db";
import { eq } from "drizzle-orm";
import { exportQueue, EXPORT_QUEUE } from "../modules/exports";
import { executeExport, developmentExportsOnly } from "../modules/exports";
import { closeRenderer } from "../lib/valo-render";
import { logger } from "../lib/logger";
import { reconcileDueReminders } from "../modules/tasks";
import { recoverAbandonedExports, reconcileExportOrphans } from "../modules/exports";
import { expireGeneratedExports } from "../modules/exports";
import {
  processPaymentEvents,
  reconcilePayments,
  processRefundQueue,
  reconcileDisputeActions,
  reconcileKnownDisputes,
} from "../modules/commerce";
import {
  OPERATIONS_QUEUE,
  OPERATIONAL_DOMAINS,
  OPERATIONS_QUEUE_OPTIONS,
  operationalJobRunner,
  operationsHealthy,
  type OperationalDomain,
} from "../lib/valo-operations-queue";
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
// Outside production the worker runs the schedule timekeeper for the scheduled operations queue.
const operationsEnabled = setting("NODE_ENV") !== "production";
const boss = exportQueue({ schedules: operationsEnabled });
const operationalHealth = new Map<OperationalDomain, boolean>();
const runOperationalJob = operationalJobRunner(
  {
    sources: reconcileSourceMonitoring,
    reminders: () => reconcileDueReminders(),
    paymentEvents: () => processPaymentEvents(),
    refunds: () => processRefundQueue(),
    disputes: () => reconcileKnownDisputes(),
    disputeActions: () => reconcileDisputeActions(),
    paymentReconciliation: () => reconcilePayments(),
  },
  (domain, healthy) => {
    operationalHealth.set(domain, healthy);
    if (!healthy) logger.error({ event: "operational.dispatch_failed", domain });
  },
);
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
    await closeRenderer();
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
  // Each domain's job runs on its own, so all seven can run at once, as the minute loop did.
  if (operationsEnabled && !stopping)
    await boss.work(
      OPERATIONS_QUEUE,
      { batchSize: 1, localConcurrency: OPERATIONAL_DOMAINS.length, pollingIntervalSeconds: 2 },
      async (jobs) => {
        for (const job of jobs) await runOperationalJob(job.data);
      },
    );
})();
let operationalCheckedAt = 0;
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
    // An idle queue must still prove that every configured queue is reachable, and outside
    // production that each operational domain still has its schedule.
    const names = operationsEnabled
      ? [EXPORT_QUEUE, WORKSPACE_EXPORT_QUEUE, OPERATIONS_QUEUE]
      : [EXPORT_QUEUE, WORKSPACE_EXPORT_QUEUE];
    const queueQuery = {
      text: "SELECT name,policy,retry_limit,expire_seconds FROM valo_jobs.queue WHERE name=ANY($1::text[])",
      values: [names],
      query_timeout: 1500,
    };
    const queues = await pool.query(queueQuery);
    if (
      queues.rows.length !== names.length ||
      !queues.rows.some((q) => q.name === EXPORT_QUEUE && q.retry_limit === 2 && q.expire_seconds === 120) ||
      !queues.rows.some(
        (q) => q.name === WORKSPACE_EXPORT_QUEUE && q.retry_limit === 0 && q.expire_seconds === 360,
      ) ||
      (operationsEnabled &&
        !queues.rows.some(
          (q) =>
            q.name === OPERATIONS_QUEUE &&
            q.policy === OPERATIONS_QUEUE_OPTIONS.policy &&
            q.retry_limit === OPERATIONS_QUEUE_OPTIONS.retryLimit &&
            q.expire_seconds === OPERATIONS_QUEUE_OPTIONS.expireInSeconds,
        ))
    )
      throw Error("WORKER_QUEUE_CONFIGURATION_INVALID");
    if (operationsEnabled) {
      const scheduleQuery = {
        text: "SELECT key FROM valo_jobs.schedule WHERE name=$1",
        values: [OPERATIONS_QUEUE],
        query_timeout: 1500,
      };
      const keys = new Set((await pool.query(scheduleQuery)).rows.map((r) => r.key));
      if (OPERATIONAL_DOMAINS.some((domain) => !keys.has(domain))) throw Error("WORKER_SCHEDULES_MISSING");
    }
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
    succeeded = operationsHealthy(operationalHealth);
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
