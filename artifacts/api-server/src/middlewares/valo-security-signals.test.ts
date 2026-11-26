import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

// The counter needs no database here: a stand-in records each signal. The modules only name one.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const secret = "synthetic-security-signal-key-for-unit-tests-only";
process.env.SESSION_SECRET = secret;
const { securitySignals } = await import("./valo-security-signals");
const { securitySubjectHash } = await import("../lib/valo-security-signals");

/**
 * SEC-008, SEC-005 and the security baseline's v5.0.0-16.3.3 (docs/architecture/alerts.md, part 2): each
 * refused request is counted by the caller's keyed address, as the kind of refusal it is, after its answer
 * is sent: a refusal of access, a refusal by a limit, and an answer refusing the request's input.
 */
test("each refusal is counted as its kind, by the keyed address of the caller, a page render's visitor included", async () => {
  const recorded: { kind: string; subject: string }[] = [];
  const host = express();
  host.use(
    securitySignals({
      record: async (kind, subject) => {
        recorded.push({ kind, subject });
      },
    }),
  );
  for (const status of [200, 204, 401, 403, 404, 409, 429, 400, 413, 415, 422, 500, 503])
    host.get(`/status/${status}`, (_req, res) => void res.status(status).json({ status }));
  // A route that names a more specific event is counted as that event.
  host.post("/webhook", (_req, res) => {
    res.locals.valoSecuritySignal = "signature_failure";
    res.status(401).json({});
  });
  const server = host.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const settle = async (count: number) => {
    for (let n = 0; n < 50 && recorded.length < count; n++)
      await new Promise((resolve) => setTimeout(resolve, 10));
  };
  try {
    for (const status of [200, 204, 401, 403, 404, 409, 429, 400, 413, 415, 422, 500, 503])
      await (await fetch(`${origin}/status/${status}`)).body?.cancel();
    await (await fetch(`${origin}/webhook`, { method: "POST" })).body?.cancel();
    await settle(8);
    const direct = securitySubjectHash(secret, "ip", "127.0.0.1");
    assert.deepEqual(
      recorded.map((signal) => signal.kind),
      [
        "denied_access",
        "denied_access",
        "limit_refusal",
        "refused_input",
        "refused_input",
        "refused_input",
        "refused_input",
        "signature_failure",
      ],
    );
    assert.ok(recorded.every((signal) => signal.subject === direct));

    // A page the web server renders on this machine passes on its visitor's address: the refusal is
    // counted for the visitor, never for the web server, which renders every visitor's pages.
    recorded.length = 0;
    for (const visitor of ["198.51.100.7", "203.0.113.9"])
      await (await fetch(`${origin}/status/429`, { headers: { "X-Forwarded-For": visitor } })).body?.cancel();
    await settle(2);
    assert.deepEqual(recorded, [
      { kind: "limit_refusal", subject: securitySubjectHash(secret, "ip", "198.51.100.7") },
      { kind: "limit_refusal", subject: securitySubjectHash(secret, "ip", "203.0.113.9") },
    ]);
    // A forwarded value that is not an address is not taken: the refusal is the web server's own.
    recorded.length = 0;
    await (
      await fetch(`${origin}/status/422`, { headers: { "X-Forwarded-For": "synthetic-not-an-address" } })
    ).body?.cancel();
    await settle(1);
    assert.deepEqual(recorded, [{ kind: "refused_input", subject: direct }]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
