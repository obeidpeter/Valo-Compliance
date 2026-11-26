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
import { versionedEvidencePath } from "../../lib/versioned-evidence-path";
import { PRIVACY_REQUEST_AIM_DAYS } from "../../lib/valo-privacy-state";

const securityQueries = [
  readinessQueries.deniedAccess,
  readinessQueries.signatureFailures,
  readinessQueries.roleChanges,
  readinessQueries.bulkExports,
  readinessQueries.paymentActivity,
  readinessQueries.aiActivity,
];
import { WorkerHealth } from "../../platform/valo-worker-health";
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
    // The security readings, the reading of privacy requests past Valo's own aim, and the readings of
    // reminders, the job queue and the request counts are zero here; their alerts have their own tests.
    const security = new Set<string>([
      ...securityQueries,
      readinessQueries.guardRefusals,
      readinessQueries.privilegedReading,
      readinessQueries.historyIntegrity,
      readinessQueries.privacyRequests,
      readinessQueries.reminders,
      readinessQueries.jobQueue,
      readinessQueries.requestFailures,
      readinessQueries.requestTime,
    ]);
    const failures = await collectOperationalSample(async (sql) => {
      if (sql === readinessQueries.database) throw Error("SYNTHETIC_PRIVATE_DB_ERROR");
      return { rows: [{ value: security.has(sql) ? 0 : sql === readinessQueries.payments ? 2 : 101 }] };
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
      fileURLToPath(new URL("../../../../../docs/valo/operating-runbooks.md", import.meta.url)),
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

// SEC-008: "Alert on repeated denied access, bulk exports, role changes, signature failures and
// unusual payment/AI activity."
test("security signals raise their own alerts, owned by the security and payment runbooks", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("EXTERNAL_MESSAGES_FORBIDDEN");
  };
  const dir = await mkdtemp(join(tmpdir(), "valo-ops-security-"));
  const worker = new WorkerHealth();
  worker.finish(worker.begin()!, true);
  try {
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    const sample = (security: (sql: string) => number) =>
      collectOperationalSample(
        async (sql) => ({
          rows: [
            {
              value:
                sql === readinessQueries.database ? 1 : securityQueries.includes(sql) ? security(sql) : 0,
            },
          ],
        }),
        dir,
      );
    // Twenty refusals of one address in ten minutes is within the limit; nothing else happened.
    const quiet = await sample((sql) => (sql === readinessQueries.deniedAccess ? 20 : 0));
    assert.deepEqual((await recordOperationalAlerts(quiet, dir)).active, []);
    // One more refusal, and one of each other event, raise one alert each.
    const busy = await sample((sql) => (sql === readinessQueries.deniedAccess ? 21 : 1));
    const raised = await recordOperationalAlerts(busy, dir);
    assert.deepEqual(raised.owners, [
      {
        code: "DENIED_ACCESS_DETECTED",
        runbook: "Security/privacy incident",
        accountable: "Incident lead + privacy owner",
      },
      {
        code: "SIGNATURE_FAILURES_DETECTED",
        runbook: "Security/privacy incident",
        accountable: "Incident lead + privacy owner",
      },
      {
        code: "ROLE_CHANGES_DETECTED",
        runbook: "Security/privacy incident",
        accountable: "Incident lead + privacy owner",
      },
      {
        code: "BULK_EXPORTS_DETECTED",
        runbook: "Security/privacy incident",
        accountable: "Incident lead + privacy owner",
      },
      {
        code: "PAYMENT_ACTIVITY_DETECTED",
        runbook: "Payment/entitlement failure",
        accountable: "Finance + engineering",
      },
      {
        code: "AI_ACTIVITY_DETECTED",
        runbook: "Security/privacy incident",
        accountable: "Incident lead + privacy owner",
      },
    ]);
    // They resolve when the signals stop.
    assert.deepEqual((await recordOperationalAlerts(await sample(() => 0), dir)).active, []);
    const history = JSON.parse(await readFile(join(dir, "alerts.json"), "utf8")) as {
      events: { state: string }[];
    };
    assert.equal(history.events.filter((e) => e.state === "resolved").length, 6);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

// ADM-009: "tampering and excessive privileged access generate alerts" (docs/architecture/audit-trail.md).
test("a database guard's refusal and heavy privileged reading raise their own alerts, under the security runbook", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("EXTERNAL_MESSAGES_FORBIDDEN");
  };
  const dir = await mkdtemp(join(tmpdir(), "valo-ops-history-"));
  const worker = new WorkerHealth();
  worker.finish(worker.begin()!, true);
  try {
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    const sample = (readings: { guardRefusals?: number; privilegedReading?: number }) =>
      collectOperationalSample(
        async (sql) => ({
          rows: [
            {
              value:
                sql === readinessQueries.database
                  ? 1
                  : sql === readinessQueries.guardRefusals
                    ? (readings.guardRefusals ?? 0)
                    : sql === readinessQueries.privilegedReading
                      ? (readings.privilegedReading ?? 0)
                      : 0,
            },
          ],
        }),
        dir,
      );
    // A staff member reading a hundred distinct things in an hour is within the limit, and no guard
    // refused anything.
    assert.deepEqual(
      (await recordOperationalAlerts(await sample({ privilegedReading: 100 }), dir)).active,
      [],
    );
    // One refusal by a guard, and one more thing read, raise one alert each.
    const raised = await recordOperationalAlerts(
      await sample({ guardRefusals: 1, privilegedReading: 101 }),
      dir,
    );
    assert.deepEqual(raised.owners, [
      {
        code: "GUARD_REFUSALS_DETECTED",
        runbook: "Security/privacy incident",
        accountable: "Incident lead + privacy owner",
      },
      {
        code: "PRIVILEGED_READING_DETECTED",
        runbook: "Security/privacy incident",
        accountable: "Incident lead + privacy owner",
      },
    ]);
    // They resolve when the readings return to normal.
    assert.deepEqual((await recordOperationalAlerts(await sample({}), dir)).active, []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

// ADM-009: a change made outside the application, found by the hourly count of the histories.
test("a history whose digest no longer matches its rows raises an alert, and no recent count makes its probe unavailable", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("EXTERNAL_MESSAGES_FORBIDDEN");
  };
  const dir = await mkdtemp(join(tmpdir(), "valo-ops-digests-"));
  const worker = new WorkerHealth();
  worker.finish(worker.begin()!, true);
  try {
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    const sample = (mismatched: number) =>
      collectOperationalSample(
        async (sql) => ({
          rows: [
            {
              value:
                sql === readinessQueries.database
                  ? 1
                  : sql === readinessQueries.historyIntegrity
                    ? mismatched
                    : 0,
            },
          ],
        }),
        dir,
      );
    const owner = { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" };
    // The latest count found every digest matching.
    assert.deepEqual((await recordOperationalAlerts(await sample(0), dir)).active, []);
    // It found one that does not.
    assert.deepEqual((await recordOperationalAlerts(await sample(1), dir)).owners, [
      { code: "HISTORY_INTEGRITY_DETECTED", ...owner },
    ]);
    // No count is under two hours old: the reading is unavailable, which is an alert of its own.
    assert.deepEqual((await recordOperationalAlerts(await sample(-1), dir)).owners, [
      { code: "HISTORY_INTEGRITY_PROBE_UNAVAILABLE", ...owner },
    ]);
    assert.deepEqual((await recordOperationalAlerts(await sample(0), dir)).active, []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

// PRV-003 (docs/architecture/privacy-requests.md, slice 3): a privacy request still open after the date
// Valo aims to finish it by raises an alert under the deletion and recovery runbook. That date is Valo's
// own aim, not a time limit set by law.
test("a privacy request open past the date Valo aims to finish it by raises an alert under the deletion and recovery runbook, and a failed reading makes its probe unavailable", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("EXTERNAL_MESSAGES_FORBIDDEN");
  };
  const dir = await mkdtemp(join(tmpdir(), "valo-ops-privacy-"));
  const worker = new WorkerHealth();
  worker.finish(worker.begin()!, true);
  try {
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    const sample = (open: number | "unreadable") =>
      collectOperationalSample(async (sql) => {
        if (sql === readinessQueries.privacyRequests && open === "unreadable")
          throw Error("SYNTHETIC_PROBE_FAILURE");
        return {
          rows: [
            {
              value:
                sql === readinessQueries.database ? 1 : sql === readinessQueries.privacyRequests ? open : 0,
            },
          ],
        };
      }, dir);
    const owner = { runbook: "Deletion and recovery", accountable: "Engineering + privacy owner" };
    // Every open request is within Valo's own aim.
    assert.deepEqual((await recordOperationalAlerts(await sample(0), dir)).active, []);
    // Two are past it.
    assert.deepEqual((await recordOperationalAlerts(await sample(2), dir)).owners, [
      { code: "PRIVACY_REQUESTS_BACKLOG", ...owner },
    ]);
    // The reading failed, which is an alert of its own.
    assert.deepEqual((await recordOperationalAlerts(await sample("unreadable"), dir)).owners, [
      { code: "PRIVACY_REQUESTS_PROBE_UNAVAILABLE", ...owner },
    ]);
    assert.deepEqual((await recordOperationalAlerts(await sample(0), dir)).active, []);
    // The reading counts requests not yet done, refused or cancelled, made more than Valo's own aim ago.
    assert.match(readinessQueries.privacyRequests, /status NOT IN \('fulfilled','rejected','cancelled'\)/);
    assert.ok(readinessQueries.privacyRequests.includes(`interval '${PRIVACY_REQUEST_AIM_DAYS} days'`));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

// docs/architecture/alerts.md, part 3: reminder emails and scheduled jobs waiting past their time raise
// backlogs under the worker's runbook; requests failing unexpectedly or slow raise alerts under the site's,
// at NFR-003's own limits: fewer than 1 in 100 failing, and 95 in 100 within a second.
test("waiting reminders and jobs, and failing or slow requests, raise their own alerts under their runbooks, past their limits only", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("EXTERNAL_MESSAGES_FORBIDDEN");
  };
  const dir = await mkdtemp(join(tmpdir(), "valo-ops-service-"));
  const worker = new WorkerHealth();
  worker.finish(worker.begin()!, true);
  try {
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    type Readings = Partial<Record<"reminders" | "jobQueue" | "requestFailures" | "requestTime", number>>;
    const sample = (readings: Readings, unreadable?: keyof Readings) =>
      collectOperationalSample(async (sql) => {
        if (unreadable && sql === readinessQueries[unreadable]) throw Error("SYNTHETIC_PROBE_FAILURE");
        const named = (Object.keys(readings) as (keyof Readings)[]).find(
          (name) => readinessQueries[name] === sql,
        );
        return {
          rows: [{ value: sql === readinessQueries.database ? 1 : named ? readings[named] : 0 }],
        };
      }, dir);
    const queueOwner = { runbook: "Broken export / AI outage", accountable: "Engineering" };
    const site = { runbook: "Site/database unavailable", accountable: "Engineering lead" };
    // At their limits: nothing waiting, 10 failures in 1,000, and 95 in 100 within a second.
    assert.deepEqual(
      (await recordOperationalAlerts(await sample({ requestFailures: 10, requestTime: 1000 }), dir)).active,
      [],
    );
    // Over them.
    const raised = await recordOperationalAlerts(
      await sample({ reminders: 3, jobQueue: 1, requestFailures: 11, requestTime: 2500 }),
      dir,
    );
    assert.deepEqual(raised.owners, [
      { code: "REMINDERS_BACKLOG", ...queueOwner },
      { code: "JOB_QUEUE_BACKLOG", ...queueOwner },
      { code: "REQUEST_FAILURES_DETECTED", ...site },
      { code: "REQUEST_TIME_DETECTED", ...site },
    ]);
    // A reading that cannot be taken is an alert of its own.
    assert.deepEqual((await recordOperationalAlerts(await sample({}, "requestTime"), dir)).owners, [
      { code: "REQUEST_TIME_PROBE_UNAVAILABLE", ...site },
    ]);
    assert.deepEqual((await recordOperationalAlerts(await sample({}), dir)).active, []);
    // The readings: reminders still pending fifteen minutes past their time; jobs still waiting ten
    // minutes past their start; and the request counts of the last ten minutes, read as nothing below a
    // hundred requests.
    assert.match(readinessQueries.reminders, /status='pending'/);
    assert.match(readinessQueries.reminders, /interval '15 minutes'/);
    assert.match(readinessQueries.jobQueue, /valo_jobs\.job WHERE state IN \('created','retry'\)/);
    assert.match(readinessQueries.jobQueue, /interval '10 minutes'/);
    for (const name of ["requestFailures", "requestTime"] as const) {
      assert.match(readinessQueries[name], /COALESCE\(sum\(requests\), 0\) < 100 THEN 0/);
      assert.match(readinessQueries[name], /interval '10 minutes'/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
