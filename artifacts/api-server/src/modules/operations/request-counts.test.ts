import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { Writable } from "node:stream";
import { ValoProblem } from "../../platform/valo-problem";

// The counts need no database; the modules only name one, which a unit run never opens.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const {
  REQUEST_TIME_BOUNDS,
  RequestCounts,
  UNWRITTEN_MINUTES_KEPT,
  startRequestCountWriter,
  writeRequestCounts,
  writeRequestMinutes,
} = await import("./request-counts");
const { requestCounting } = await import("../../middlewares/valo-request-counts");
const { onError } = await import("../../platform/http-errors");
const { requestLogging } = await import("../../platform/http-logging");
const { createApplicationLogger } = await import("../../platform/logger");

/**
 * NFR-003, NFR-010 (docs/architecture/alerts.md, part 3): the API counts its requests by the minute they
 * began in, with their unexpected failures and their times, and writes each minute's counts once, outside
 * any transaction. These tests replace the database with a stand-in that only records.
 */

const MINUTE = 60_000;
const at = (minute: number, second = 0) => Date.UTC(2026, 10, 26, 9, minute, second);

/** A stand-in for the database that keeps each statement it is sent, or refuses them all. */
function database(refuse?: Error) {
  const sent: { text: string; values: unknown[] }[] = [];
  return {
    sent,
    query: async (text: string, values: unknown[]) => {
      if (refuse) throw refuse;
      sent.push({ text, values });
      return {};
    },
  };
}

test("each request is counted in the minute it began, with whether it failed and the times it took at most", () => {
  const counts = new RequestCounts();
  counts.count(at(0, 1), 80, false);
  counts.count(at(0, 59), 1000, true);
  counts.count(at(0, 30), 10001, false);
  counts.count(at(1, 0), 300, false);
  // The minute under way is not finished, so it is not taken.
  assert.deepEqual(
    counts.take(at(1, 30)).map(([minute, minuteCounts]) => [minute, minuteCounts]),
    [
      [
        at(0),
        {
          requests: 3,
          failures: 1,
          // Within 100, 250, 500 ms, 1 s, 2.5 s, 5 s and 10 s: each count holds every shorter one.
          within: [1, 1, 1, 2, 2, 2, 2],
        },
      ],
    ],
  );
  assert.equal(counts.waiting, 1);
  assert.deepEqual(
    counts.take(at(1, 30), true).map(([minute, minuteCounts]) => [minute, minuteCounts]),
    [[at(1), { requests: 1, failures: 0, within: [0, 0, 1, 1, 1, 1, 1] }]],
  );
  assert.equal(counts.waiting, 0);
  assert.equal(REQUEST_TIME_BOUNDS.length, 7);
  // With no writer taking them, the counts keep an hour of minutes and drop the oldest.
  const unattended = new RequestCounts();
  for (let minute = 0; minute < UNWRITTEN_MINUTES_KEPT + 3; minute++)
    unattended.count(at(0) + minute * MINUTE, 10, false);
  assert.deepEqual([unattended.waiting, unattended.dropped], [UNWRITTEN_MINUTES_KEPT + 1, 2]);
  assert.equal(unattended.take(at(0) + 3 * MINUTE)[0]?.[0], at(2));
});

test("counts the database cannot take wait for the next write, an hour of minutes at most", async () => {
  const counts = new RequestCounts();
  counts.count(at(0), 50, false);
  counts.count(at(1), 50, true);
  const refusal = Object.assign(Error("SYNTHETIC_DATABASE_DOWN"), { code: "ECONNREFUSED" });
  const down = database(refusal);
  assert.deepEqual(await writeRequestCounts({ counts, query: down.query, now: at(2) }), {
    written: 0,
    waiting: 2,
    dropped: 0,
    error: refusal,
  });
  // More requests in a minute already waiting are added to it.
  counts.count(at(1, 20), 50, false);
  const up = database();
  assert.deepEqual(await writeRequestCounts({ counts, query: up.query, now: at(2) }), {
    written: 2,
    waiting: 0,
    dropped: 0,
  });
  assert.equal(up.sent.length, 1, "every minute in one statement");
  assert.deepEqual(up.sent[0]!.values, [
    new Date(at(0)).toISOString(),
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    new Date(at(1)).toISOString(),
    2,
    1,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
  ]);
  // A minute another process wrote too is added to, never replaced.
  assert.match(
    up.sent[0]!.text,
    /ON CONFLICT \(minute\) DO UPDATE SET requests = valo_request_minutes\.requests \+ excluded\.requests/,
  );
  for (const column of ["failures", "within_100ms", "within_1s", "within_10s"])
    assert.match(
      up.sent[0]!.text,
      new RegExp(`${column} = valo_request_minutes\\.${column} \\+ excluded\\.${column}`),
    );
  // Nothing to write sends nothing.
  await writeRequestMinutes([], up.query);
  assert.equal(up.sent.length, 1);

  // While the database stays down, an hour of minutes is kept, and an older one is dropped and counted.
  for (let minute = 0; minute < UNWRITTEN_MINUTES_KEPT + 5; minute++)
    counts.count(at(0) + minute * MINUTE, 10, false);
  const result = await writeRequestCounts({ counts, query: down.query, now: at(0) + 70 * MINUTE });
  assert.deepEqual([result.written, result.waiting, result.dropped], [0, UNWRITTEN_MINUTES_KEPT, 5]);
});

test("the API's own requests are counted after their answer, and only an unexpected failure counts as one", async () => {
  const counts = new RequestCounts();
  const host = express();
  // The application's request logger, which the error handler writes to, writing nowhere here.
  host.use(
    requestLogging(
      createApplicationLogger(
        new Writable({
          write(_chunk, _encoding, next) {
            next();
          },
        }),
      ),
    ),
  );
  host.use(requestCounting(counts));
  host.get("/api/fine", (_req, res) => res.json({ ok: true }));
  host.get("/api/broken", () => {
    throw Error("SYNTHETIC_UNEXPECTED_FAILURE");
  });
  host.get("/api/waiting", () => {
    throw new ValoProblem(503, "Synthetic: a database update is waiting.");
  });
  host.get("/api/refused", () => {
    throw new ValoProblem(403, "Synthetic refusal.");
  });
  host.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
  host.get("/api/__clerk/v1/client", (_req, res) => res.json({}));
  host.get("/elsewhere", (_req, res) => res.json({}));
  host.use(onError);
  const server = host.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const [path, status] of [
      ["/api/fine", 200],
      ["/api/broken", 503],
      ["/api/waiting", 503],
      ["/api/refused", 403],
      ["/api/missing", 404],
      ["/api/healthz", 200],
      ["/api/__clerk/v1/client", 200],
      ["/elsewhere", 200],
    ] as const) {
      const response = await fetch(origin + path);
      assert.equal(response.status, status, path);
      await response.text();
    }
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  // The health check, the identity provider's proxy and anything outside the API are not counted; the
  // unexpected failure is the only failure, and not the 503 Valo meant to give.
  const taken = counts.take(Date.now(), true);
  assert.equal(
    taken.reduce((sum, [, minute]) => sum + minute.requests, 0),
    5,
  );
  assert.equal(
    taken.reduce((sum, [, minute]) => sum + minute.failures, 0),
    1,
  );
});

test("the writer writes the finished minutes once a minute, logs a failing write once until one succeeds, and writes the rest as it stops", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: at(0, 10) });
  const counts = new RequestCounts();
  const logged: { level: string; event: string }[] = [];
  const log = {
    warn: (fields: object) => logged.push({ level: "warn", event: (fields as { event: string }).event }),
    info: (fields: object) => logged.push({ level: "info", event: (fields as { event: string }).event }),
  };
  let refusing = true;
  const sent: string[] = [];
  const query = async (text: string) => {
    if (refusing && text.startsWith("INSERT"))
      throw Object.assign(Error("SYNTHETIC_DOWN"), { code: "ECONNREFUSED" });
    sent.push(text.trim().split(/\s+/)[0]!);
    return {};
  };
  const settle = async () => {
    for (let n = 0; n < 10; n++) await new Promise((resolve) => setImmediate(resolve));
  };
  const stop = startRequestCountWriter(log, counts, query);
  counts.count(Date.now(), 20, false);
  // A minute on, the first minute is finished but the database refuses it, twice: logged once.
  t.mock.timers.tick(MINUTE);
  await settle();
  t.mock.timers.tick(MINUTE);
  await settle();
  assert.deepEqual(
    logged.map((entry) => entry.event),
    ["operations.request_counts_unwritten"],
  );
  assert.equal(counts.waiting, 1);
  // Old minutes are removed, at most once an hour, even while the counts wait.
  assert.deepEqual(sent, ["DELETE"]);
  // The database is back: the waiting minute is written, and the recovery is logged.
  refusing = false;
  t.mock.timers.tick(MINUTE);
  await settle();
  assert.equal(counts.waiting, 0);
  assert.deepEqual(sent, ["DELETE", "INSERT"]);
  assert.deepEqual(
    logged.map((entry) => entry.event),
    ["operations.request_counts_unwritten", "operations.request_counts_written"],
  );
  // As the process stops, the minute under way is written too.
  counts.count(Date.now(), 20, false);
  await stop();
  assert.deepEqual(sent, ["DELETE", "INSERT", "INSERT"]);
  assert.equal(counts.waiting, 0);
});
