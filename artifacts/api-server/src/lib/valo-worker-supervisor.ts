import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";
import { workerReadiness, WORKER_FRESH_MS, type WorkerHeartbeat } from "./valo-worker-health";
import { environment } from "../platform/settings";

export const supervisorTiming = Object.freeze({
  pollMs: 1000,
  startupMs: 120_000,
  unhealthyMs: 30_000,
  // The worker has a 70 second overall drain deadline.
  drainMs: 75_000,
  killMs: 5000,
  restartBaseMs: 1000,
  restartMaxMs: 30_000,
  restartWindowMs: 600_000,
  maxRestarts: 5,
});
type Timing = { [K in keyof typeof supervisorTiming]: number };
type Reason =
  | "exited"
  | "spawn_failed"
  | "startup_timeout"
  | "unhealthy"
  | "shutdown"
  | "shutdown_failed"
  | "kill_timeout";
type Event = {
  event:
    | "worker_supervisor.started"
    | "worker_supervisor.ready"
    | "worker_supervisor.stopping"
    | "worker_supervisor.restart"
    | "worker_supervisor.exhausted"
    | "worker_supervisor.stopped";
  reason?: Reason;
  attempt?: number;
};
type Options = {
  signal: AbortSignal;
  launch: () => ChildProcess;
  report: (event: Event) => void;
  observeWorker?: (health: WorkerHeartbeat | null) => void;
  observeOperations?: (value: { healthy: boolean; checkedAt: string }) => void;
  timing?: Timing;
};

/** Child-bound IPC avoids trusting another process that happens to own a health port.
 * Never starts a replacement until the previous process has actually exited. */
export async function superviseWorker({
  signal,
  launch,
  report,
  observeWorker,
  observeOperations,
  timing: t = supervisorTiming,
}: Options): Promise<number> {
  const restarts: number[] = [];
  let attempt = 0;
  while (!signal.aborted) {
    let reason: Reason = "spawn_failed";
    reason = await new Promise<Reason>((resolve) => {
      let child: ChildProcess;
      try {
        child = launch();
      } catch {
        resolve("spawn_failed");
        return;
      }
      const started = performance.now();
      let lastHealthy: number | null = null,
        heartbeat: WorkerHeartbeat | null = null;
      let instance: string | undefined,
        stopAt: number | null = null,
        killedAt: number | null = null;
      let stopReason: Reason | undefined,
        settled = false,
        announcedReady = false;
      const finish = (why: Reason) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        signal.removeEventListener("abort", stop);
        child.off("message", message);
        observeWorker?.(null);
        resolve(why);
      };
      const terminate = (why: Reason) => {
        if (stopAt !== null) return;
        stopReason = why;
        stopAt = performance.now();
        observeWorker?.(null);
        report({ event: "worker_supervisor.stopping", reason: why });
        child.kill("SIGTERM");
      };
      const stop = () => terminate("shutdown");
      const message = (raw: unknown) => {
        const value = raw as {
          type?: string;
          heartbeat?: WorkerHeartbeat;
          healthy?: boolean;
          checkedAt?: string;
        } | null;
        if (
          value?.type === "valo.worker.operations" &&
          stopAt === null &&
          typeof value.healthy === "boolean" &&
          typeof value.checkedAt === "string"
        ) {
          observeOperations?.({ healthy: value.healthy, checkedAt: value.checkedAt });
          return;
        }
        if (value?.type !== "valo.worker.health" || !value.heartbeat || stopAt !== null) return;
        const next = value.heartbeat;
        if (instance !== undefined && next.instanceId !== instance) return;
        heartbeat = next;
        observeWorker?.(next);
        // Invalid messages cannot refresh readiness or establish process identity.
        if (workerReadiness(next) === "healthy") {
          instance = next.instanceId;
          lastHealthy = performance.now();
          if (!announcedReady) {
            announcedReady = true;
            report({ event: "worker_supervisor.ready" });
          }
        }
      };
      const timer = setInterval(() => {
        const now = performance.now();
        if (stopAt !== null) {
          if (killedAt === null && now - stopAt >= t.drainMs) {
            killedAt = now;
            child.kill("SIGKILL");
          } else if (killedAt !== null && now - killedAt >= t.killMs) finish("kill_timeout");
        } else if (lastHealthy === null) {
          if (now - started >= t.startupMs) terminate("startup_timeout");
        } else if (
          (workerReadiness(heartbeat) !== "healthy" && now - lastHealthy >= t.unhealthyMs) ||
          now - lastHealthy >= WORKER_FRESH_MS + t.unhealthyMs
        )
          terminate("unhealthy");
      }, t.pollMs);
      child.on("message", message);
      child.once("error", () => {
        if (!child.pid) finish("spawn_failed");
        else terminate("spawn_failed");
      });
      child.once("exit", (code, exitSignal) =>
        finish(
          signal.aborted && (code !== 0 || exitSignal !== null)
            ? "shutdown_failed"
            : (stopReason ?? "exited"),
        ),
      );
      signal.addEventListener("abort", stop, { once: true });
      report({ event: "worker_supervisor.started" });
      observeWorker?.(null);
      if (signal.aborted) stop();
    });
    if (reason === "kill_timeout") {
      report({ event: "worker_supervisor.exhausted", reason });
      return 1;
    }
    if (reason === "shutdown_failed") {
      report({ event: "worker_supervisor.stopped", reason });
      return 1;
    }
    if (signal.aborted) {
      report({ event: "worker_supervisor.stopped", reason: "shutdown" });
      return 0;
    }
    const now = performance.now();
    while (restarts.length && now - restarts[0]! >= t.restartWindowMs) restarts.shift();
    if (restarts.length >= t.maxRestarts) {
      report({ event: "worker_supervisor.exhausted", reason });
      return 1;
    }
    restarts.push(now);
    attempt++;
    report({ event: "worker_supervisor.restart", reason, attempt });
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(t.restartMaxMs, t.restartBaseMs * 2 ** (restarts.length - 1)));
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
    });
  }
  return 0;
}

export function launchBuiltWorker(entry: string) {
  return spawn(process.execPath, ["--enable-source-maps", entry], {
    env: { ...environment(), VALO_SUPERVISED_WORKER: "ipc-v1" },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
}
