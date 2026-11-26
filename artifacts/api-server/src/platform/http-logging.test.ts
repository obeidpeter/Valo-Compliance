import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import { createApplicationLogger } from "./logger";
import { requestLogging, routePattern } from "./http-logging";
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

// NFR-010 (docs/architecture/alerts.md, part 3): each request's log line names the route it matched, by its
// pattern, so a slow or failing route can be found, and never a value from the address.
test("each request's log line names its route's pattern and never a value from the address", async () => {
  const marker = "SYNTHETIC_PRIVATE_ROUTE_VALUE_4417";
  const id = "6f1c2b9e-0d3a-4c5e-9f7a-1b2c3d4e5f60";
  let captured = "";
  const sink = new Writable({
    write(chunk, _encoding, next) {
      captured += String(chunk);
      next();
    },
  });
  const host = express();
  host.use(requestLogging(createApplicationLogger(sink)));
  // As the API mounts its routers: on fixed paths, with the values in the routes' own patterns.
  const api = express.Router(),
    cases = express.Router();
  cases.get("/:id", (_req, res) => res.json({ ok: true }));
  cases.post("/:id/respond", (_req, res) => res.json({ ok: true }));
  api.use("/admin/privacy-cases", cases);
  api.get("/v1/exports/:id/file", async (_req, res) => {
    // An answer sent later, after the router has moved on.
    await new Promise((resolve) => setTimeout(resolve, 5));
    res.json({ ok: true });
  });
  host.use("/api", api);
  host.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  const server = host.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const [method, path, status] of [
      ["GET", `/api/admin/privacy-cases/${id}?private=${marker}`, 200],
      ["POST", `/api/admin/privacy-cases/${marker}/respond`, 200],
      ["GET", `/api/v1/exports/${id}/file`, 200],
      ["GET", `/api/nothing/${marker}`, 404],
    ] as const) {
      const response = await fetch(origin + path, { method });
      assert.equal(response.status, status, path);
      await response.text();
    }
    await new Promise((r) => setImmediate(r));
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
  assert.equal(captured.includes(marker), false);
  assert.equal(captured.includes(id), false);
  const routes = captured
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { route?: string; res?: unknown })
    .filter((record) => record.res)
    .map((record) => record.route);
  assert.deepEqual(routes, [
    "/api/admin/privacy-cases/:id",
    "/api/admin/privacy-cases/:id/respond",
    "/api/v1/exports/:id/file",
    "unmatched",
  ]);
  // A part that is not a fixed word or a named parameter is never written.
  for (const [req, expected] of [
    [{ baseUrl: "/api", route: { path: "/v1/exports" } }, "/api/v1/exports"],
    [{ baseUrl: "/api/admin/privacy-cases", route: { path: "/" } }, "/api/admin/privacy-cases"],
    [{ baseUrl: "", route: { path: "/" } }, "/"],
    [{ baseUrl: `/api/workspace/${id}`, route: { path: "/files" } }, "unrecognised"],
    [{ baseUrl: "/api/orders", route: { path: "/1234567" } }, "unrecognised"],
    // Shaped like a fixed word, but an identifier or a number all the same.
    [
      { baseUrl: "/api/workspace/a1b2c3d4-e5f6-4789-a012-345678901234", route: { path: "/files" } },
      "unrecognised",
    ],
    [{ baseUrl: "/api/orders", route: { path: "/v20261126" } }, "unrecognised"],
    [{ baseUrl: "/api", route: { path: /^\/private/ } }, "unrecognised"],
    [{ baseUrl: "/api", route: { path: "/Private Name" } }, "unrecognised"],
    [{ baseUrl: "/api", route: { path: "/files/*rest" } }, "unrecognised"],
    [{ baseUrl: "/api" }, "unmatched"],
  ] as const)
    assert.equal(routePattern(req), expected, JSON.stringify(req));
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
