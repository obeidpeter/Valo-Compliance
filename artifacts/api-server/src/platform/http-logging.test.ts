import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import { createApplicationLogger } from "./logger";
import { requestLogging } from "./http-logging";
import { guardRefusal, onError, saysUnexpectedFailure } from "./http-errors";
test("real HTTP request, parser and application error logs omit private markers but retain correlation/status", async () => {
  const marker = "SYNTHETIC_PRIVATE_HTTP_A_B_912836";
  let captured = "";
  const sink = new Writable({
    write(chunk, _encoding, next) {
      captured += String(chunk);
      next();
    },
  });
  const log = createApplicationLogger(sink);
  const host = express();
  host.use(requestLogging(log));
  host.use(express.json());
  host.post("/failure/:privateName", (_req, _res, next) => {
    const error = new Error(marker, { cause: new Error(marker) });
    error.name = marker;
    next(error);
  });
  host.post("/ok/:privateName", (_req, res) => res.json({ ok: true }));
  host.use(onError);
  const server = host.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const [route, body, status] of [
      ["ok", JSON.stringify({ private: marker }), 200],
      ["failure", JSON.stringify({ private: marker }), 503],
      ["ok", `{"${marker}":`, 400],
    ] as const) {
      const response = await fetch(`${origin}/${route}/${marker}?private=${marker}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${marker}`,
          Cookie: `session=${marker}`,
        },
        body,
      });
      assert.equal(response.status, status);
      await response.text();
    }
    await new Promise((r) => setImmediate(r));
    assert.ok(captured.length > 0);
    assert.equal(captured.includes(marker), false);
    const records = captured
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.ok(records.some((r) => r.event === "request.failed" && r.errorType === "Error"));
    for (const status of [200, 400, 503])
      assert.ok(records.some((r) => r.res?.statusCode === status && r.req?.id));
    assert.equal(records.filter((r) => r.res).length, 3);
    // Positive leak-detector canary: the assertion would detect an actual marker.
    assert.equal((captured + marker).includes(marker), true);
    const output = resolve("generated-artifacts/valo-security");
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, "http-log-capture.json"),
      JSON.stringify(
        {
          executedAt: new Date().toISOString(),
          scope: "Real isolated HTTP host using the application's request logger and error handler",
          managedIdentityAcceptance: false,
          privateMarkerAbsent: !captured.includes(marker),
          positiveLeakCanaryDetected: (captured + marker).includes(marker),
          observedStatuses: [200, 503, 400],
          records,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

// ADM-009 (docs/architecture/audit-trail.md): a refusal by a database guard reaches the handler as an
// unexpected failure. It is answered as one, and counted as a security signal, logging only the guard.
test("a database guard's refusal is answered as a failure, counted as a security signal and logged by the guard's name alone", async () => {
  const marker = "SYNTHETIC_PRIVATE_GUARD_REFUSAL_5521";
  // As Drizzle reports one: "Failed query", with PostgreSQL's own error, naming the function, as its cause.
  const refused = (code: string, where?: string) =>
    new Error(`Failed query: update valo_privacy_events set reason = $1 params: ${marker}`, {
      cause: Object.assign(new Error(`Privacy case history is append-only ${marker}`), { code, where }),
    });
  const guardWhere = "PL/pgSQL function valo_privacy_history_guard() line 9 at RAISE";
  assert.equal(guardRefusal(refused("23514", guardWhere)), "valo_privacy_history_guard");
  assert.equal(
    guardRefusal(refused("P0001", "PL/pgSQL function public.valo_audit_truncate_guard() line 3 at RAISE")),
    "valo_audit_truncate_guard",
  );
  // A check constraint, a key or a timeout names no raising function, and is not a guard's refusal.
  for (const other of [
    refused("23514"),
    refused("23505"),
    refused("57014"),
    refused("P0001", "SQL statement"),
    new Error(marker),
    null,
    "text",
  ])
    assert.equal(guardRefusal(other), null);
  let captured = "";
  const sink = new Writable({
    write(chunk, _encoding, next) {
      captured += String(chunk);
      next();
    },
  });
  const host = express();
  host.use(requestLogging(createApplicationLogger(sink)));
  const signals: (string | undefined)[] = [];
  // The security-signal middleware's contract: it counts the kind the response leaves in res.locals.
  host.use((_req, res, next) => {
    res.once("finish", () => signals.push(res.locals.valoSecuritySignal));
    next();
  });
  host.post("/guarded", (_req, _res, next) => next(refused("23514", guardWhere)));
  host.post("/checked", (_req, _res, next) => next(refused("23514")));
  host.use(onError);
  const server = host.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    for (const route of ["guarded", "checked"]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/${route}`, { method: "POST" });
      assert.equal(response.status, 503);
      assert.ok(saysUnexpectedFailure(await response.text()));
    }
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(signals, ["guard_refusal", undefined]);
    const records = captured
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      records.filter((r) => r.event === "request.refused_by_guard").map((r) => r.guard),
      ["valo_privacy_history_guard"],
    );
    assert.equal(captured.includes(marker), false, "neither the guard's message nor the query is logged");
  } finally {
    server.close();
  }
});
