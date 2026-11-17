import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALERT_RUNBOOKS,
  alertRunbook,
  collectOperationalSample,
  recordOperationalAlerts,
  recordWorkerHeartbeat,
  readinessQueries,
} from "./valo-operations";
import { versionedEvidencePath } from "./versioned-evidence-path";
import { WorkerHealth } from "./valo-worker-health";
test("operator report names reject traversal and non-integer versions", () => {
  for (const version of [
    "../../private",
    "7",
    "1000000",
    "1.5",
    NaN,
    Infinity,
    0,
    -1,
    1.5,
    1000001,
    Number.MAX_SAFE_INTEGER,
    1e21,
    null,
    undefined,
    {},
    [],
    true,
  ])
    assert.throws(() => versionedEvidencePath("/synthetic/root", version), /INVALID_EVIDENCE_VERSION/);
  assert.equal(
    versionedEvidencePath("/synthetic/root", 7),
    resolve("/synthetic/root/docs/valo/evidence/operational-publication-v7.json"),
  );
  for (const boundary of [1, 1000000])
    assert.equal(
      versionedEvidencePath("/synthetic/root", boundary),
      resolve(`/synthetic/root/docs/valo/evidence/operational-publication-v${boundary}.json`),
    );
});
test("internal probes measure failures independently and persist/deduplicate/recover alerts without transports", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls++;
    throw Error("EXTERNAL_MESSAGES_FORBIDDEN");
  };
  const dir = await mkdtemp(join(tmpdir(), "valo-ops-"));
  const worker = new WorkerHealth();
  worker.finish(worker.begin()!, true);
  try {
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    const failures = await collectOperationalSample(async (sql) => {
      if (sql === readinessQueries.database) throw Error("SYNTHETIC_PRIVATE_DB_ERROR");
      return { rows: [{ value: sql === readinessQueries.payments ? 2 : 101 }] };
    }, dir);
    assert.equal(failures.database.status, "unavailable");
    assert.equal(failures.worker.status, "healthy");
    assert.equal(failures.payments.value, 2);
    const parallel = await Promise.all(
      Array.from({ length: 32 }, () => recordOperationalAlerts(failures, dir)),
    );
    assert.equal(
      parallel.reduce((n, r) => n + r.emitted, 0),
      6,
    );
    let history = JSON.parse(await readFile(join(dir, "alerts.json"), "utf8"));
    assert.equal(history.events.length, 6);
    assert.ok(history.active.includes("WORKSPACE_CLEANUP_BACKLOG"));
    assert.ok(history.active.includes("EXPORT_RETENTION_BACKLOG"));
    assert.ok(!JSON.stringify(history).includes("SYNTHETIC_PRIVATE"));
    await writeFile(
      join(dir, "worker.json"),
      JSON.stringify({ at: new Date(Date.now() - 100000).toISOString(), pid: process.pid }),
    );
    const stale = await collectOperationalSample(
      async (sql) => ({ rows: [{ value: sql === readinessQueries.database ? 1 : 0 }] }),
      dir,
    );
    assert.equal(stale.worker.status, "stale");
    await recordOperationalAlerts(stale, dir);
    worker.finish(worker.begin()!, true);
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    const healthy = await collectOperationalSample(
      async (sql) => ({ rows: [{ value: sql === readinessQueries.database ? 1 : 0 }] }),
      dir,
    );
    assert.deepEqual((await recordOperationalAlerts(healthy, dir)).active, []);
    history = JSON.parse(await readFile(join(dir, "alerts.json"), "utf8"));
    assert.equal(history.events.filter((r: { state: string }) => r.state === "resolved").length, 7);
    await writeFile(join(dir, "alerts.json"), "{bad");
    await assert.rejects(() => recordOperationalAlerts(healthy, dir), /INTERNAL_ALERT_HISTORY_UNREADABLE/);
    await writeFile(join(dir, "alerts.json"), JSON.stringify(history));
    assert.equal(
      (await recordOperationalAlerts(healthy, dir)).emitted,
      0,
      "a failed local write must not poison later queued work",
    );
    await writeFile(join(dir, "worker.json"), "{bad");
    assert.equal(
      (await collectOperationalSample(async () => ({ rows: [{ value: 0 }] }), dir)).worker.status,
      "unavailable",
    );
    worker.finish(worker.begin()!, false);
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    assert.equal(
      (await collectOperationalSample(async () => ({ rows: [{ value: 1 }] }), dir)).worker.status,
      "unavailable",
      "a fresh timestamp cannot hide a failed dispatch",
    );
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

test("every alert names its accountable roles and a runbook from the operating runbooks", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("EXTERNAL_MESSAGES_FORBIDDEN");
  };
  const dir = await mkdtemp(join(tmpdir(), "valo-ops-owners-"));
  try {
    // Every probe failing, then every metric over its limit: between them, every alert this
    // module can raise. No worker heartbeat exists, so the worker alert is active in both.
    const failing = await collectOperationalSample(async () => {
      throw Error("SYNTHETIC_PROBE_FAILURE");
    }, dir);
    const over = await collectOperationalSample(
      async (sql) => ({ rows: [{ value: sql === readinessQueries.database ? 1 : 10000 }] }),
      dir,
    );
    const codes = new Set<string>();
    for (const sample of [failing, over])
      for (const owner of (await recordOperationalAlerts(sample, dir)).owners) {
        codes.add(owner.code);
        assert.ok(owner.runbook && owner.accountable, `${owner.code} has no runbook or accountable roles`);
      }
    const metrics = Object.keys(readinessQueries).length - 1;
    assert.equal(codes.size, 2 + 2 * metrics, [...codes].join(", "));

    // Each runbook is a row of the operating runbooks, with the same accountable roles.
    const runbooks = readFileSync(
      fileURLToPath(new URL("../../../../docs/valo/operating-runbooks.md", import.meta.url)),
      "utf8",
    );
    const rows = new Map(
      [...runbooks.matchAll(/^\| ([^|]+?) \| ([^|]+?) \|/gm)].map((row) => [row[1]!, row[2]!]),
    );
    for (const code of codes) {
      const owner = alertRunbook(code)!;
      assert.equal(rows.get(owner.runbook), owner.accountable, `${code}: ${owner.runbook}`);
    }
    for (const owner of Object.values(ALERT_RUNBOOKS))
      assert.equal(rows.get(owner.runbook), owner.accountable, owner.runbook);
    assert.equal(alertRunbook("SOMETHING_ELSE_BACKLOG"), null);
    assert.equal(alertRunbook("toString"), null);

    // The journal records them with each alert, for whoever reads it.
    const history = JSON.parse(await readFile(join(dir, "alerts.json"), "utf8")) as {
      events: { code: string; runbook: string; accountable: string }[];
    };
    for (const event of history.events)
      assert.deepEqual(
        { runbook: event.runbook, accountable: event.accountable },
        { ...alertRunbook(event.code) },
      );
    assert.ok(!JSON.stringify(history).includes("SYNTHETIC_PROBE_FAILURE"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
