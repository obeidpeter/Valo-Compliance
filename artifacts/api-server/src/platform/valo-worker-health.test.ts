import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  MaintenanceGate,
  WorkerHealth,
  workerReadiness,
  workerHealthServer,
  WORKER_FRESH_MS,
  WORKER_MAINTENANCE_INTERVAL_MS,
  exportWorkerConcurrency,
} from "./valo-worker-health";
test("failed, concurrent-error, stalled and draining workers cannot renew a healthy result", () => {
  let now = Date.now();
  const h = new WorkerHealth(() => now);
  assert.equal(workerReadiness(h.snapshot(), now), "unavailable");
  h.finish(h.begin()!, true);
  assert.equal(workerReadiness(h.snapshot(), now), "healthy");
  const inFlight = h.begin()!;
  h.fail();
  h.finish(inFlight, true);
  assert.equal(workerReadiness(h.snapshot(), now), "unavailable");
  now += 100;
  h.finish(h.begin()!, true);
  assert.equal(workerReadiness(h.snapshot(), now), "healthy");
  h.begin();
  now += WORKER_FRESH_MS + 1;
  assert.equal(workerReadiness(h.snapshot(), now), "stale");
  const before = h.snapshot();
  h.drain();
  h.finish(1, true);
  assert.equal(h.begin(), null);
  assert.equal(workerReadiness(h.snapshot(), now), "unavailable");
  assert.equal(h.snapshot().lastSuccessAt, before.lastSuccessAt);
  assert.equal(
    workerReadiness({ at: new Date().toISOString(), pid: process.pid }, now),
    "unavailable",
    "legacy timestamp-only records cannot prove readiness",
  );
  assert.equal(
    workerReadiness(
      { ...before, dispatchStartedAt: null, lastSuccessAt: new Date(now + 100).toISOString() },
      now,
    ),
    "unavailable",
  );
});
test("loopback liveness and readiness distinguish failures and expose no operational details", async () => {
  const h = new WorkerHealth(),
    server = await workerHealthServer(h, 0),
    address = server.address() as { address: string; port: number };
  assert.equal(address.address, "127.0.0.1");
  const url = `http://127.0.0.1:${address.port}`;
  const response = async (path: string) => {
    const r = await fetch(url + path);
    const body = (await r.json()) as object;
    assert.deepEqual(Object.keys(body), ["status"]);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return r.status;
  };
  try {
    assert.equal(await response("/healthz"), 200);
    assert.equal(await response("/readyz"), 503);
    h.finish(h.begin()!, true);
    assert.equal(await response("/readyz"), 200);
    h.finish(h.begin()!, false);
    assert.equal(await response("/readyz"), 503);
    assert.equal(await response("/healthz"), 200);
    h.finish(h.begin()!, true);
    assert.equal(await response("/readyz"), 200);
    h.drain();
    assert.equal(await response("/readyz"), 503);
    assert.equal(await response("/healthz"), 503);
    assert.equal(await response("/private"), 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("a hung shutdown has a bounded nonzero process exit; a completed drain exits cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "valo-worker-drain-"));
  try {
    for (const hang of [false, true]) {
      const file = join(dir, hang ? "hang.mjs" : "clean.mjs");
      await writeFile(
        file,
        `import{drainWithDeadline}from ${JSON.stringify(new URL("./valo-worker-health.ts", import.meta.url).href)};\nawait drainWithDeadline(()=>${hang ? "new Promise(()=>{})" : "Promise.resolve()"},200);console.log('DRAINED');`,
      );
      const child = spawnSync(process.execPath, ["--import", "tsx", file], {
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(child.error, undefined);
      assert.equal(child.status, hang ? 1 : 0, child.stderr);
      assert.equal(child.stdout.includes("DRAINED"), !hang);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("exportWorkerConcurrency budgets parallel exports against the worker pool and refuses oversubscription", () => {
  // Default 10-connection pool with 7 operational slots stays at 1 concurrent export.
  assert.equal(exportWorkerConcurrency(undefined, 10, 7), 1);
  // Raising the pool to 15 unlocks 5 parallel exports (15 - 7 ops - 3 reserved = 5).
  assert.equal(exportWorkerConcurrency(undefined, 15, 7), 5);
  // Capped at Chromium's 5-PDF limit even with a large pool.
  assert.equal(exportWorkerConcurrency(undefined, 50, 7), 5);
  // Production rehearsal without scheduled operations unlocks 5 exports on a 10-connection pool.
  assert.equal(exportWorkerConcurrency(undefined, 10, 0), 5);
  // Explicit valid setting within budget is respected.
  assert.equal(exportWorkerConcurrency("3", 15, 7), 3);
  // Explicit setting above pool budget or outside 1..5 fails closed.
  assert.throws(() => exportWorkerConcurrency("3", 10, 7), /EXPORT_CONCURRENCY_EXCEEDS_POOL_BUDGET/);
  assert.throws(() => exportWorkerConcurrency("0", 20, 0), /INVALID_EXPORT_CONCURRENCY/);
  assert.throws(() => exportWorkerConcurrency("6", 20, 0), /INVALID_EXPORT_CONCURRENCY/);
  assert.throws(() => exportWorkerConcurrency(" 2", 20, 0), /INVALID_EXPORT_CONCURRENCY/);
});
test("MaintenanceGate runs once at startup and waits for its interval before running again", () => {
  let now = 1_000;
  const gate = new MaintenanceGate(WORKER_MAINTENANCE_INTERVAL_MS, () => now);
  assert.equal(gate.due(), true);
  gate.mark();
  assert.equal(gate.due(), false);
  now += WORKER_MAINTENANCE_INTERVAL_MS - 1;
  assert.equal(gate.due(), false);
  now += 1;
  assert.equal(gate.due(), true);
  gate.mark();
  assert.equal(gate.due(), false);
});
