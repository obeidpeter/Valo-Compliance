import { mkdir, open, readFile, rename, unlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { assertApplicationRuntime, runtimeEnvironment } from "./valo-runtime-activation";
import { workerReadiness, type WorkerHeartbeat } from "./valo-worker-health";
export const operationsDirectory = resolve("generated-artifacts/valo-operations");
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
} as const;
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
  worker: { status: "healthy" | "stale" | "unavailable"; ageMs: number | null };
  limits: {
    exports: number;
    cleanup: number;
    exportRetention: number;
    workspaceCleanup: number;
    workerAgeMs: number;
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
    limits: { exports: 100, cleanup: 0, exportRetention: 0, workspaceCleanup: 0, workerAgeMs: 90000 },
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
} as const;
export function alertRunbook(code: string) {
  const subject = code.replace(/_(BACKLOG|PROBE_UNAVAILABLE|UNAVAILABLE)$/, "");
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
