import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export const WORKER_FRESH_MS = 90_000;
export const WORKER_MAINTENANCE_INTERVAL_MS = 30_000;
export const MAX_EXPORT_CONCURRENCY = 5;
/** Connections kept free for workspace export, outbox dispatch and heartbeats alongside operations. */
const WORKER_BASE_RESERVED_CONNECTIONS = 3;

/**
 * Budgets document export concurrency (1-5, matching the Chromium PDF limit) against the worker's
 * PostgreSQL pool so parallel exports never starve scheduled operational jobs or heartbeats.
 */
export function exportWorkerConcurrency(
  raw: string | undefined,
  poolMax: number,
  operationsSlots: number,
): number {
  const available = Math.max(
    1,
    Math.min(MAX_EXPORT_CONCURRENCY, poolMax - operationsSlots - WORKER_BASE_RESERVED_CONNECTIONS),
  );
  if (raw === undefined || raw === "") return available;
  if (raw.trim() !== raw || !/^[1-5]$/.test(raw)) throw Error("INVALID_EXPORT_CONCURRENCY");
  const requested = Number(raw);
  const maxAllowed = Math.max(1, poolMax - operationsSlots - WORKER_BASE_RESERVED_CONNECTIONS);
  if (requested > maxAllowed) throw Error("EXPORT_CONCURRENCY_EXCEEDS_POOL_BUDGET");
  return requested;
}

/** Runs slow housekeeping once on startup and then at most once per interval. */
export class MaintenanceGate {
  private lastRunAt: number | null = null;
  constructor(
    private readonly intervalMs = WORKER_MAINTENANCE_INTERVAL_MS,
    private readonly now = Date.now,
  ) {}
  due(): boolean {
    return this.lastRunAt === null || this.now() - this.lastRunAt >= this.intervalMs;
  }
  mark(): void {
    this.lastRunAt = this.now();
  }
}
export type WorkerHeartbeat = {
  version: 2;
  instanceId: string;
  phase: "starting" | "running" | "failed" | "draining";
  lastSuccessAt: string | null;
  dispatchStartedAt: string | null;
  dispatches: number;
};
export function workerReadiness(raw: unknown, now = Date.now()): "healthy" | "stale" | "unavailable" {
  const h = raw as Partial<WorkerHeartbeat> | null;
  if (
    !h ||
    h.version !== 2 ||
    h.phase !== "running" ||
    typeof h.instanceId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(h.instanceId) ||
    !Number.isSafeInteger(h.dispatches) ||
    h.dispatches! < 1 ||
    typeof h.lastSuccessAt !== "string"
  )
    return "unavailable";
  const age = now - Date.parse(h.lastSuccessAt);
  if (!Number.isFinite(age) || age < 0) return "unavailable";
  if (age > WORKER_FRESH_MS) return "stale";
  if (h.dispatchStartedAt !== null) {
    if (typeof h.dispatchStartedAt !== "string") return "unavailable";
    const busyAge = now - Date.parse(h.dispatchStartedAt);
    if (!Number.isFinite(busyAge) || busyAge < 0) return "unavailable";
    if (busyAge > WORKER_FRESH_MS) return "stale";
  }
  return "healthy";
}
/** A queue error during a dispatch cannot be erased by that dispatch's completion. */
export class WorkerHealth {
  private value: WorkerHeartbeat = {
    version: 2,
    instanceId: randomUUID(),
    phase: "starting",
    lastSuccessAt: null,
    dispatchStartedAt: null,
    dispatches: 0,
  };
  private failures = 0;
  constructor(private now = Date.now) {}
  begin() {
    if (this.value.phase === "draining" || this.value.dispatchStartedAt) return null;
    this.value.dispatchStartedAt = new Date(this.now()).toISOString();
    return this.failures;
  }
  finish(started: number, success: boolean) {
    this.value.dispatchStartedAt = null;
    this.value.dispatches++;
    if (this.value.phase === "draining") return;
    if (success && started === this.failures) {
      this.value.lastSuccessAt = new Date(this.now()).toISOString();
      this.value.phase = "running";
    } else this.fail();
  }
  fail() {
    this.failures++;
    if (this.value.phase !== "draining") this.value.phase = "failed";
  }
  drain() {
    this.value.phase = "draining";
  }
  get stopping() {
    return this.value.phase === "draining";
  }
  snapshot(): WorkerHeartbeat {
    return { ...this.value };
  }
}
/** Loopback only. No IDs, queue contents, environment values or error messages in HTTP. */
export async function workerHealthServer(health: WorkerHealth, port: number) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error("INVALID_WORKER_HEALTH_PORT");
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "GET" || !["/healthz", "/readyz"].includes(req.url ?? "")) {
      res.writeHead(404);
      res.end('{"status":"not_found"}');
      return;
    }
    const ready = workerReadiness(health.snapshot()) === "healthy";
    const ok = req.url === "/healthz" ? !health.stopping : ready;
    res.writeHead(ok ? 200 : 503);
    res.end(JSON.stringify({ status: ok ? "ok" : "unavailable" }));
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
/** A pending database/SDK promise must not hold SIGTERM indefinitely. A forced
 * exit leaves existing queue leases/reservations for the normal recovery path. */
export async function drainWithDeadline(work: () => Promise<void>, timeoutMs = 70_000) {
  const deadline = setTimeout(() => process.exit(1), timeoutMs);
  try {
    await work();
  } finally {
    clearTimeout(deadline);
  }
}
