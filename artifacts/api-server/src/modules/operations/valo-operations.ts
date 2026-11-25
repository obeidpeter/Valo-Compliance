import { mkdir, open, readFile, rename, unlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { assertApplicationRuntime, runtimeEnvironment } from "../../platform/valo-runtime-activation";
import { workerReadiness, type WorkerHeartbeat } from "../../platform/valo-worker-health";
import { quotaPolicy, type QuotaBucket } from "../../lib/valo-quota-policy";
export const operationsDirectory = resolve("generated-artifacts/valo-operations");
/** Live windows of the named quota buckets that reached their limit: one caller using all of it. */
const atQuotaLimit = (buckets: readonly QuotaBucket[]) =>
  `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_rate_buckets WHERE expires_at > now() AND (${buckets
    .map((bucket) => `(bucket='${bucket}' AND used_count >= ${quotaPolicy[bucket]})`)
    .join(" OR ")}) LIMIT 10001) bounded`;
export const readinessQueries = {
  database: "SELECT 1 AS value",
  exports:
    "SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_export_jobs WHERE status IN ('queued','running') LIMIT 10001) bounded",
  cleanup:
    "SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_export_objects WHERE state='cleanup' AND next_cleanup_at<=now() LIMIT 10001) bounded",
  exportRetention: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_file_assets a
    JOIN valo_export_jobs j ON j.id=a.job_id AND j.workspace_id=a.workspace_id
    WHERE j.status='ready' AND a.retention_at<=now() LIMIT 10001) bounded`,
  workspaceCleanup: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_workspace_export_attempts a
    JOIN valo_workspace_exports j ON j.id=a.job_id AND j.workspace_id=a.workspace_id
    WHERE (a.status='cleanup' OR j.status IN ('cancelled','expired'))
      AND (a.next_cleanup_at<=now() OR a.cleanup_error_code IS NOT NULL) LIMIT 10001) bounded`,
  payments: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_orders o WHERE o.status='verified_success' AND
    (NOT EXISTS(SELECT 1 FROM valo_entitlements e WHERE e.order_id=o.id AND e.workspace_id=o.workspace_id)
    OR NOT EXISTS(SELECT 1 FROM valo_purchase_outbox r WHERE r.order_id=o.id AND r.workspace_id=o.workspace_id AND r.kind='purchase_receipt')) LIMIT 10001) bounded`,
  // SEC-008's security signals. Refusals by the most refused address in ten minutes:
  deniedAccess: `SELECT COALESCE(max(total), 0)::int AS value FROM (SELECT sum(count) AS total
    FROM valo_security_signals WHERE kind='denied_access' AND window_started_at > now() - interval '10 minutes'
    GROUP BY subject_hash) per_subject`,
  signatureFailures: `SELECT COALESCE(sum(count), 0)::int AS value FROM valo_security_signals
    WHERE kind='signature_failure' AND window_started_at > now() - interval '10 minutes'`,
  roleChanges:
    "SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_staff_role_changes WHERE created_at > now() - interval '1 hour' LIMIT 10001) bounded",
  bulkExports: atQuotaLimit(["export-create"]),
  paymentActivity: atQuotaLimit([
    "checkout-create",
    "checkout-create-day",
    "refund-create",
    "refund-create-day",
  ]),
  aiActivity: atQuotaLimit(["customer-ai"]),
  // ADM-009 (docs/architecture/audit-trail.md). Application requests a database guard refused in ten
  // minutes: the application never sends a change a guard refuses, so each is a fault or an attempt to
  // change a history.
  guardRefusals: `SELECT COALESCE(sum(count), 0)::int AS value FROM valo_security_signals
    WHERE kind='guard_refusal' AND window_started_at > now() - interval '10 minutes'`,
  // The most distinct things one staff member read in the last hour, by the access history.
  privilegedReading: `SELECT COALESCE(max(objects), 0)::int AS value FROM (SELECT count(DISTINCT object) AS objects
    FROM valo_staff_access_audit WHERE created_at > now() - interval '1 hour' AND object <> 'unrecorded'
    GROUP BY actor_id) per_actor`,
} as const;
/** Each security reading and the subject its alerts are named after. */
const SECURITY_METRICS = [
  ["deniedAccess", "DENIED_ACCESS"],
  ["signatureFailures", "SIGNATURE_FAILURES"],
  ["roleChanges", "ROLE_CHANGES"],
  ["bulkExports", "BULK_EXPORTS"],
  ["paymentActivity", "PAYMENT_ACTIVITY"],
  ["aiActivity", "AI_ACTIVITY"],
  ["guardRefusals", "GUARD_REFUSALS"],
  ["privilegedReading", "PRIVILEGED_READING"],
] as const;
type Metric = { status: "ok" | "unavailable"; value: number | null; elapsedMs: number };
export type OperationalSample = {
  checkedAt: string;
  scope: "development-project-local" | "production-rehearsal-local";
  database: Metric;
  exports: Metric;
  cleanup: Metric;
  exportRetention: Metric;
  workspaceCleanup: Metric;
  payments: Metric;
  deniedAccess: Metric;
  signatureFailures: Metric;
  roleChanges: Metric;
  bulkExports: Metric;
  paymentActivity: Metric;
  aiActivity: Metric;
  guardRefusals: Metric;
  privilegedReading: Metric;
  worker: { status: "healthy" | "stale" | "unavailable"; ageMs: number | null };
  limits: {
    exports: number;
    cleanup: number;
    exportRetention: number;
    workspaceCleanup: number;
    workerAgeMs: number;
    deniedAccess: number;
    signatureFailures: number;
    roleChanges: number;
    bulkExports: number;
    paymentActivity: number;
    aiActivity: number;
    guardRefusals: number;
    privilegedReading: number;
  };
};
async function atomicJson(file: string, value: unknown) {
  const temp = file + "." + randomUUID() + ".tmp";
  const fd = await open(temp, "wx", 0o600);
  try {
    await fd.writeFile(JSON.stringify(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  try {
    await rename(temp, file);
  } finally {
    // After a successful rename the temporary file is already gone; otherwise this is best-effort cleanup.
    await unlink(temp).catch(() => {});
  }
}
export async function recordWorkerHeartbeat(health: WorkerHeartbeat, directory = operationsDirectory) {
  assertApplicationRuntime();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await atomicJson(join(directory, "worker.json"), {
    ...health,
    at: new Date().toISOString(),
    pid: process.pid,
  });
}
export async function collectOperationalSample(
  query: (sql: string) => Promise<{ rows: { value: unknown }[] }>,
  directory = operationsDirectory,
): Promise<OperationalSample> {
  assertApplicationRuntime();
  const metrics = await Promise.all(
    Object.entries(readinessQueries).map(async ([key, sql]) => {
      const start = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          query(sql),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error("PROBE_TIMEOUT")), 2000);
          }),
        ]);
        const value = Number(result.rows[0]?.value);
        if (!Number.isSafeInteger(value) || value < 0) throw Error("INVALID_METRIC");
        return [key, { status: "ok", value, elapsedMs: Math.round(performance.now() - start) }] as const;
      } catch {
        return [
          key,
          { status: "unavailable", value: null, elapsedMs: Math.round(performance.now() - start) },
        ] as const;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  let worker: OperationalSample["worker"] = { status: "unavailable", ageMs: null };
  try {
    const raw = await readFile(join(directory, "worker.json"), "utf8");
    if (raw.length > 1000) throw Error("INVALID_HEARTBEAT");
    const heartbeat = JSON.parse(raw),
      at = Date.parse(heartbeat.at),
      ageMs = Date.now() - at;
    if (!Number.isFinite(at) || ageMs < 0 || !Number.isSafeInteger(heartbeat.pid))
      throw Error("INVALID_HEARTBEAT");
    process.kill(heartbeat.pid, 0);
    worker = { status: ageMs > 90000 ? "stale" : workerReadiness(heartbeat), ageMs };
  } catch {
    /* Absence, malformed data or a dead worker is not a healthy heartbeat. */
  }
  return {
    ...Object.fromEntries(metrics),
    checkedAt: new Date().toISOString(),
    scope: runtimeEnvironment() === "production" ? "production-rehearsal-local" : "development-project-local",
    worker,
    limits: {
      exports: 100,
      cleanup: 0,
      exportRetention: 0,
      workspaceCleanup: 0,
      workerAgeMs: 90000,
      // Development defaults, not reviewed thresholds: more than 20 refusals of one address in ten
      // minutes, and any signature failure, role change or caller at a quota limit, raise an alert.
      deniedAccess: 20,
      signatureFailures: 0,
      roleChanges: 0,
      bulkExports: 0,
      paymentActivity: 0,
      aiActivity: 0,
      // Development defaults too: any refusal by a database guard, and a staff member reading more than
      // a hundred distinct records or lists in an hour, raise an alert.
      guardRefusals: 0,
      privilegedReading: 100,
    },
  } as OperationalSample;
}
/**
 * NFR-010: every alert names its accountable roles and the runbook to follow, as
 * docs/valo/operating-runbooks.md names them. They are role assignments, not named or staffed
 * responders. Keyed by what the alert is about; a test drives every alert this module raises.
 */
export const ALERT_RUNBOOKS = {
  DATABASE: { runbook: "Site/database unavailable", accountable: "Engineering lead" },
  WORKER: { runbook: "Broken export / AI outage", accountable: "Engineering" },
  EXPORTS: { runbook: "Broken export / AI outage", accountable: "Engineering" },
  CLEANUP: { runbook: "Deletion and recovery", accountable: "Engineering + privacy owner" },
  EXPORT_RETENTION: { runbook: "Deletion and recovery", accountable: "Engineering + privacy owner" },
  WORKSPACE_CLEANUP: { runbook: "Deletion and recovery", accountable: "Engineering + privacy owner" },
  PAYMENTS: { runbook: "Payment/entitlement failure", accountable: "Finance + engineering" },
  DENIED_ACCESS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  SIGNATURE_FAILURES: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  ROLE_CHANGES: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  BULK_EXPORTS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  PAYMENT_ACTIVITY: { runbook: "Payment/entitlement failure", accountable: "Finance + engineering" },
  AI_ACTIVITY: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  GUARD_REFUSALS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  PRIVILEGED_READING: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
} as const;
export function alertRunbook(code: string) {
  const subject = code.replace(/_(BACKLOG|DETECTED|PROBE_UNAVAILABLE|UNAVAILABLE)$/, "");
  return Object.hasOwn(ALERT_RUNBOOKS, subject)
    ? ALERT_RUNBOOKS[subject as keyof typeof ALERT_RUNBOOKS]
    : null;
}
type Alert = {
  id: string;
  at: string;
  code: string;
  state: "active" | "resolved";
  runbook?: string | null;
  accountable?: string | null;
};
type AlertState = { sequence: number; active: string[]; events: Alert[]; sample?: OperationalSample };
/** Internal only. Atomic bounded project-local journal, not a production monitor/audit archive. */
const pendingAlertWrites = new Map<string, Promise<void>>();
export async function recordOperationalAlerts(sample: OperationalSample, directory = operationsDirectory) {
  assertApplicationRuntime();
  const key = join(directory, "."),
    previous = pendingAlertWrites.get(key) ?? Promise.resolve();
  // Local contention waits in FIFO order instead of consuming the interprocess
  // lock's bounded retry window. The file lock still protects separate workers.
  const result = previous.then(() => recordOperationalAlertsLocked(sample, directory));
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  pendingAlertWrites.set(key, tail);
  try {
    return await result;
  } finally {
    if (pendingAlertWrites.get(key) === tail) pendingAlertWrites.delete(key);
  }
}
async function recordOperationalAlertsLocked(sample: OperationalSample, directory: string) {
  assertApplicationRuntime();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "alerts.lock"),
    file = join(directory, "alerts.json");
  let acquired = false;
  for (let n = 0; n < 200 && !acquired; n++) {
    try {
      const fd = await open(lock, "wx", 0o600);
      await fd.writeFile(String(process.pid));
      await fd.close();
      acquired = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > 5000) {
          const pid = Number(await readFile(lock, "utf8"));
          let alive = false;
          if (Number.isSafeInteger(pid) && pid > 0)
            try {
              process.kill(pid, 0);
              alive = true;
            } catch {
              // Expected: signal 0 throws when the lock holder no longer exists.
            }
          if (!alive) await unlink(lock);
        }
      } catch {
        // Expected race: another process released or replaced the lock; retry below.
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  if (!acquired) throw Error("INTERNAL_ALERT_LOCK_UNAVAILABLE");
  try {
    let state: AlertState = { sequence: 0, active: [], events: [] };
    try {
      state = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw Error("INTERNAL_ALERT_HISTORY_UNREADABLE");
    }
    const active: string[] = [];
    if (sample.database.status !== "ok" || sample.database.value !== 1) active.push("DATABASE_UNAVAILABLE");
    if (sample.worker.status !== "healthy") active.push("WORKER_UNAVAILABLE");
    for (const name of ["exports", "cleanup", "exportRetention", "workspaceCleanup", "payments"] as const) {
      const code =
        name === "workspaceCleanup"
          ? "WORKSPACE_CLEANUP"
          : name === "exportRetention"
            ? "EXPORT_RETENTION"
            : name.toUpperCase();
      const metric = sample[name];
      if (metric.status !== "ok") active.push(code + "_PROBE_UNAVAILABLE");
      else if (metric.value! > (name === "payments" ? 0 : sample.limits[name]))
        active.push(code + "_BACKLOG");
    }
    for (const [name, subject] of SECURITY_METRICS) {
      const metric = sample[name];
      if (metric.status !== "ok") active.push(subject + "_PROBE_UNAVAILABLE");
      else if (metric.value! > sample.limits[name]) active.push(subject + "_DETECTED");
    }
    const events: Alert[] = [];
    for (const code of new Set([...state.active, ...active])) {
      if (state.active.includes(code) === active.includes(code)) continue;
      const owner = alertRunbook(code);
      events.push({
        id: randomUUID(),
        at: sample.checkedAt,
        code,
        state: active.includes(code) ? "active" : "resolved",
        runbook: owner?.runbook ?? null,
        accountable: owner?.accountable ?? null,
      });
    }
    state = {
      sequence: state.sequence + events.length,
      active,
      events: [...state.events, ...events].slice(-1000),
      sample,
    };
    await atomicJson(file, state);
    return {
      active: state.active,
      owners: state.active.map((code) => ({
        code,
        runbook: alertRunbook(code)?.runbook ?? null,
        accountable: alertRunbook(code)?.accountable ?? null,
      })),
      emitted: events.length,
      sequence: state.sequence,
    };
  } finally {
    await unlink(lock);
  }
}
