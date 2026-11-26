import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALERT_WORDS,
  alertTitle,
  collectOperationalSample,
  copyAlertChanges,
  readinessQueries,
  recordOperationalAlerts,
  recordWorkerHeartbeat,
  type AlertChange,
} from "./valo-operations";
import { WorkerHealth } from "../../platform/valo-worker-health";
import type { db } from "@workspace/db";

/**
 * SEC-008, NFR-010 (docs/architecture/alerts.md, part 1): the worker's alert changes carry what staff
 * read, and every one of them reaches the database's journal, which staff read, once the database can
 * take it. No message leaves Valo: these tests replace the database with a stand-in that only records.
 */

/** Runs `body` in development with a directory of its own, as the other operations tests do. */
async function inDevelopment(name: string, body: (dir: string) => Promise<void>) {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("EXTERNAL_MESSAGES_FORBIDDEN");
  };
  const dir = await mkdtemp(join(tmpdir(), `valo-alerts-${name}-`));
  try {
    await body(dir);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
}

/** A reading in which the database answers and every other query reads `value(query)`. */
const reading = (dir: string, value: (query: string) => number) =>
  collectOperationalSample(
    async (query) => ({ rows: [{ value: query === readinessQueries.database ? 1 : value(query) }] }),
    dir,
  );

async function healthyWorker(dir: string) {
  const worker = new WorkerHealth();
  worker.finish(worker.begin()!, true);
  await recordWorkerHeartbeat(worker.snapshot(), dir);
}

type Journal = { sequence: number; published: number; active: string[]; events: AlertChange[] };
const journal = async (dir: string) =>
  JSON.parse(await readFile(join(dir, "alerts.json"), "utf8")) as Journal;

/** A stand-in for the database's journal that keeps each copy it is given. */
function recorder() {
  const copies: AlertChange[][] = [];
  return {
    copies,
    publish: async (changes: AlertChange[]) => {
      copies.push(changes.map((change) => ({ ...change })));
    },
  };
}

/** Fails when `promise` takes longer than a second, which here means it waited on something. */
async function promptly<T>(promise: Promise<T>, what: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error(`${what} waited`)), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("every alert reads in plain words, and one whose reading Valo cannot take says so", () =>
  inDevelopment("titles", async (dir) => {
    // Every probe failing, then every reading over its limit: between them, every alert this module
    // raises. No worker heartbeat exists, so the worker's alert is active in both.
    const failing = await collectOperationalSample(async () => {
      throw Error("SYNTHETIC_PROBE_FAILURE");
    }, dir);
    const over = await reading(dir, () => 10000);
    const codes = new Set([
      ...(await recordOperationalAlerts(failing, dir)).active,
      ...(await recordOperationalAlerts(over, dir)).active,
    ]);
    assert.equal(codes.size, 2 + 2 * (Object.keys(readinessQueries).length - 1));
    for (const code of codes) {
      const subject = code.replace(/_(BACKLOG|DETECTED|PROBE_UNAVAILABLE|UNAVAILABLE)$/, "");
      assert.ok(Object.hasOwn(ALERT_WORDS, subject), `${code} has no words`);
      const words = ALERT_WORDS[subject as keyof typeof ALERT_WORDS];
      assert.equal(
        alertTitle(code),
        code.endsWith("_PROBE_UNAVAILABLE") ? `Valo cannot read ${words.reading}` : words.raised,
        code,
      );
      assert.doesNotMatch(alertTitle(code)!, /[A-Z]{2,}_|_[A-Z]{2,}/, `${code}'s title shows a code`);
    }
    for (const unknown of ["SOMETHING_ELSE_BACKLOG", "toString", "__proto__", "constructor_DETECTED", ""])
      assert.equal(alertTitle(unknown), null, unknown);
  }));

test("each change carries its place in the journal, and the reading and limit it was raised or cleared on", () =>
  inDevelopment("readings", async (dir) => {
    await healthyWorker(dir);
    assert.deepEqual((await recordOperationalAlerts(await reading(dir, () => 0), dir)).active, []);
    // A paid order without its access, and one address refused once more than its limit allows.
    const busy = await reading(dir, (query) =>
      query === readinessQueries.payments ? 2 : query === readinessQueries.deniedAccess ? 21 : 0,
    );
    assert.deepEqual((await recordOperationalAlerts(busy, dir)).active, [
      "PAYMENTS_BACKLOG",
      "DENIED_ACCESS_DETECTED",
    ]);
    // Then the database goes, while every other reading is back to nothing.
    const down = await collectOperationalSample(async (query) => {
      if (query === readinessQueries.database) throw Error("SYNTHETIC_DATABASE_DOWN");
      return { rows: [{ value: 0 }] };
    }, dir);
    assert.deepEqual((await recordOperationalAlerts(down, dir)).active, ["DATABASE_UNAVAILABLE"]);
    // Then it is back, but the export queue cannot be read.
    const unread = await collectOperationalSample(async (query) => {
      if (query === readinessQueries.exports) throw Error("SYNTHETIC_PROBE_FAILURE");
      return { rows: [{ value: query === readinessQueries.database ? 1 : 0 }] };
    }, dir);
    assert.deepEqual((await recordOperationalAlerts(unread, dir)).active, ["EXPORTS_PROBE_UNAVAILABLE"]);
    const kept = await journal(dir);
    assert.deepEqual(
      kept.events.map((change) => [
        change.sequence,
        change.code,
        change.state,
        change.reading,
        change.threshold,
      ]),
      [
        [1, "PAYMENTS_BACKLOG", "active", 2, 0],
        [2, "DENIED_ACCESS_DETECTED", "active", 21, 20],
        [3, "PAYMENTS_BACKLOG", "resolved", 0, 0],
        [4, "DENIED_ACCESS_DETECTED", "resolved", 0, 20],
        [5, "DATABASE_UNAVAILABLE", "active", null, null],
        [6, "DATABASE_UNAVAILABLE", "resolved", null, null],
        // A reading that cannot be taken has none, and still names its limit.
        [7, "EXPORTS_PROBE_UNAVAILABLE", "active", null, 100],
      ],
    );
    assert.equal(kept.sequence, 7);
    assert.equal(kept.published, 0);
    assert.deepEqual(
      kept.events.map((change) => change.at),
      [busy, busy, down, down, down, unread, unread].map((sample) => sample.checkedAt),
    );
    assert.ok(!JSON.stringify(kept.events).includes("SYNTHETIC_"));
  }));

test("the database's journal receives every change once, and a change it cannot take waits in the file", () =>
  inDevelopment("copy", async (dir) => {
    await healthyWorker(dir);
    const database = recorder();
    // No journal yet: nothing to copy, and nothing asked of the database.
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 0, behind: 0, lost: 0 });
    assert.equal(database.copies.length, 0);

    await recordOperationalAlerts(
      await reading(dir, (q) => (q === readinessQueries.roleChanges ? 1 : 0)),
      dir,
    );
    await recordOperationalAlerts(await reading(dir, () => 0), dir);
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 2, behind: 0, lost: 0 });
    assert.deepEqual(
      database.copies.map((copy) => copy.map((change) => [change.sequence, change.code, change.state])),
      [
        [
          [1, "ROLE_CHANGES_DETECTED", "active"],
          [2, "ROLE_CHANGES_DETECTED", "resolved"],
        ],
      ],
    );
    assert.deepEqual(
      database.copies[0],
      (await journal(dir)).events,
      "each change is copied as the file has it",
    );
    assert.equal((await journal(dir)).published, 2);
    // Nothing new: nothing is copied again.
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 0, behind: 0, lost: 0 });
    assert.equal(database.copies.length, 1);

    // The database cannot take the next change: it stays in the file, and the copy says how many and why.
    await recordOperationalAlerts(
      await reading(dir, (q) => (q === readinessQueries.signatureFailures ? 1 : 0)),
      dir,
    );
    const refusal = Object.assign(Error("SYNTHETIC_DATABASE_DOWN"), { code: "ECONNREFUSED" });
    assert.deepEqual(
      await copyAlertChanges(async () => {
        throw refusal;
      }, dir),
      { copied: 0, behind: 1, lost: 0, error: refusal },
    );
    assert.equal((await journal(dir)).published, 2);
    // Once it can, the next copy takes that change, and only it.
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 1, behind: 0, lost: 0 });
    assert.deepEqual(
      database.copies.at(-1)!.map((change) => [change.sequence, change.code, change.state]),
      [[3, "SIGNATURE_FAILURES_DETECTED", "active"]],
    );
    assert.equal((await journal(dir)).published, 3);
    // Every change reached it once, by its own id.
    const ids = database.copies.flat().map((change) => change.id);
    assert.deepEqual(
      ids,
      (await journal(dir)).events.map((change) => change.id),
    );
    assert.equal(new Set(ids).size, 3);
  }));

test("a journal written before its changes were numbered is numbered by their places and copied whole", () =>
  inDevelopment("earlier-journal", async (dir) => {
    const owner = { runbook: "Broken export / AI outage", accountable: "Engineering" };
    const earlier = [
      {
        id: randomUUID(),
        at: "2026-11-20T09:00:00.000Z",
        code: "EXPORTS_BACKLOG",
        state: "active",
        ...owner,
      },
      {
        id: randomUUID(),
        at: "2026-11-20T09:05:00.000Z",
        code: "EXPORTS_BACKLOG",
        state: "resolved",
        ...owner,
      },
    ];
    // Seven changes in all, of which the file kept the last two: the journal never took the first five.
    await writeFile(join(dir, "alerts.json"), JSON.stringify({ sequence: 7, active: [], events: earlier }));
    const database = recorder();
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 2, behind: 0, lost: 5 });
    assert.deepEqual(
      database.copies.flat().map((change) => [change.id, change.sequence, change.code, change.state]),
      [
        [earlier[0]!.id, 6, "EXPORTS_BACKLOG", "active"],
        [earlier[1]!.id, 7, "EXPORTS_BACKLOG", "resolved"],
      ],
    );
    const kept = await journal(dir);
    assert.equal(kept.published, 7);
    assert.deepEqual(
      kept.events.map((change) => change.sequence),
      [6, 7],
    );
    // The next reading's changes follow them.
    await healthyWorker(dir);
    await recordOperationalAlerts(
      await reading(dir, (q) => (q === readinessQueries.bulkExports ? 1 : 0)),
      dir,
    );
    assert.deepEqual(
      (await journal(dir)).events.map((change) => [change.sequence, change.code]),
      [
        [6, "EXPORTS_BACKLOG"],
        [7, "EXPORTS_BACKLOG"],
        [8, "BULK_EXPORTS_DETECTED"],
      ],
    );
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 1, behind: 0, lost: 0 });
  }));

test("a change the file no longer holds before the database took it is counted as lost, once", () =>
  inDevelopment("lost", async (dir) => {
    const owner = { runbook: "Broken export / AI outage", accountable: "Engineering" };
    const kept = [5, 6].map((sequence) => ({
      id: randomUUID(),
      sequence,
      at: `2026-11-20T09:0${sequence}:00.000Z`,
      code: "EXPORTS_BACKLOG",
      state: sequence === 5 ? "active" : "resolved",
      reading: sequence === 5 ? 101 : 0,
      threshold: 100,
      ...owner,
    }));
    // The database took the first two changes; the file has since dropped the third and fourth.
    await writeFile(
      join(dir, "alerts.json"),
      JSON.stringify({ sequence: 6, published: 2, active: [], events: kept }),
    );
    const database = recorder();
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 2, behind: 0, lost: 2 });
    assert.deepEqual(
      database.copies.flat().map((change) => change.sequence),
      [5, 6],
    );
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 0, behind: 0, lost: 0 });
  }));

test("no reading waits while the database takes a copy, and the copy moves on only past what it took", () =>
  inDevelopment("no-wait", async (dir) => {
    await healthyWorker(dir);
    await recordOperationalAlerts(
      await reading(dir, (q) => (q === readinessQueries.roleChanges ? 1 : 0)),
      dir,
    );
    let take!: () => void;
    const taken = new Promise<void>((resolve) => {
      take = resolve;
    });
    const slow: AlertChange[][] = [];
    const copying = copyAlertChanges(async (changes) => {
      slow.push(changes);
      await taken;
    }, dir);
    while (slow.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    // The database is still taking the first change: the journal's lock is free, and a reading that
    // clears the alert is written at once.
    await assert.rejects(stat(join(dir, "alerts.lock")), { code: "ENOENT" });
    const cleared = await promptly(recordOperationalAlerts(await reading(dir, () => 0), dir), "the reading");
    assert.deepEqual(cleared.active, []);
    assert.deepEqual(
      (await journal(dir)).events.map((change) => [change.sequence, change.state]),
      [
        [1, "active"],
        [2, "resolved"],
      ],
    );
    take();
    assert.deepEqual(await copying, { copied: 1, behind: 0, lost: 0 });
    // It took the first change only, so only the first is marked copied; the next copy takes the second.
    assert.equal((await journal(dir)).published, 1);
    const database = recorder();
    assert.deepEqual(await copyAlertChanges(database.publish, dir), { copied: 1, behind: 0, lost: 0 });
    assert.deepEqual(
      database.copies.flat().map((change) => [change.sequence, change.state]),
      [[2, "resolved"]],
    );
  }));

test("before the journal's migrations, reading the alerts says that a database update is waiting", async () => {
  // The reading needs no database of its own; the stand-in fails as a database without the journal does.
  process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
  const { operationalAlerts } = await import("./alert-journal");
  const actor = { identityId: "user_synthetic_alert_reader", recentMfa: true, verifiedAt: Date.now() };
  const failing = (error: Error): Pick<typeof db, "transaction"> => ({
    transaction: async () => {
      throw error;
    },
  });
  const missing = Object.assign(Error("Failed query"), {
    cause: Object.assign(Error("relation does not exist"), { code: "42P01" }),
  });
  await assert.rejects(operationalAlerts(actor, failing(missing)), {
    status: 503,
    message:
      "Alerts cannot be shown yet: a database update is waiting to be applied. Until it is, the worker keeps them in its own file.",
  });
  // Any other failure is passed on as it is.
  const other = Error("SYNTHETIC_OTHER_FAILURE");
  await assert.rejects(operationalAlerts(actor, failing(other)), (error) => error === other);
});
