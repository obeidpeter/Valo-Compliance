import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { WorkerHealth, workerReadiness, workerHealthServer, WORKER_FRESH_MS } from "./valo-worker-health";
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
