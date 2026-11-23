import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { quotaSubjectHash } from "../lib/valo-quota";
import { makeRequestReadQuota } from "./valo-quota";

const secret = "synthetic-session-secret-for-quota-tests-0001";
const hash = (kind: "ip" | "user", subject: string) => quotaSubjectHash(secret, kind, subject);

/** The read limit in front of a small app, with the quota store and the identity provider stood in. */
async function app(
  t: test.TestContext,
  options: { trustProxy?: string[]; signedIn?: string; deny?: string[] } = {},
) {
  const counted: { bucket: string; key: string }[] = [];
  const server = express();
  server.set("trust proxy", options.trustProxy ?? false);
  server.use((req, _res, next) => {
    (req as unknown as { log: { warn: () => void } }).log = { warn: () => undefined };
    next();
  });
  server.use(
    makeRequestReadQuota({
      consume: async (bucket, key) => {
        counted.push({ bucket, key });
        const allowed = !options.deny?.includes(bucket);
        return { allowed, used: allowed ? 1 : 601, retryAfter: 30, resetAt: new Date(), limit: 600 };
      },
      accountOf: () => options.signedIn ?? null,
      secret: () => secret,
      purge: () => undefined,
    }),
  );
  server.get("/api/public/catalogue", (_req, res) => res.json({ ok: true }));
  const listening = server.listen(0, "127.0.0.1");
  await new Promise<void>((done) => listening.once("listening", () => done()));
  t.after(() => new Promise<void>((done) => listening.close(() => done())));
  const origin = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
  const read = (forwardedFor?: string) =>
    fetch(origin + "/api/public/catalogue", {
      headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
    });
  return { counted, read };
}

test("a page render from this machine counts for the visitor's forwarded address, under one shared ceiling", async (t) => {
  const { counted, read } = await app(t);
  assert.equal((await read("198.51.100.7")).status, 200);
  assert.equal((await read("203.0.113.9, 198.51.100.8")).status, 200);
  const shared = { bucket: "page-render-read", key: hash("ip", "page-renders") };
  assert.deepEqual(counted, [
    shared,
    { bucket: "anonymous-read", key: hash("ip", "198.51.100.7") },
    // The entry the last proxy added counts: a visitor's own earlier entries do not.
    shared,
    { bucket: "anonymous-read", key: hash("ip", "198.51.100.8") },
  ]);
  counted.length = 0;
  // Without a forwarded address, or with one that is not an address, the read is this machine's own.
  assert.equal((await read()).status, 200);
  assert.equal((await read("not-an-address")).status, 200);
  assert.deepEqual(
    counted.map((c) => c.bucket),
    ["anonymous-read", "anonymous-read"],
  );
  assert.ok(counted.every((c) => [hash("ip", "127.0.0.1"), hash("ip", "::ffff:127.0.0.1")].includes(c.key)));
});

test("when the shared ceiling is reached, page renders are refused before the visitor's own count", async (t) => {
  const { counted, read } = await app(t, { deny: ["page-render-read"] });
  const refused = await read("198.51.100.7");
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("retry-after"), "30");
  assert.deepEqual(
    counted.map((c) => c.bucket),
    ["page-render-read"],
  );
});

test("where a proxy is trusted, Express reads the chain and the read is not treated as a page render", async (t) => {
  const { counted, read } = await app(t, { trustProxy: ["127.0.0.1/32"] });
  assert.equal((await read("198.51.100.7")).status, 200);
  assert.deepEqual(counted, [{ bucket: "anonymous-read", key: hash("ip", "198.51.100.7") }]);
});

test("a signed-in read counts for the account, whatever address it names", async (t) => {
  const { counted, read } = await app(t, { signedIn: "user_synthetic_reader" });
  assert.equal((await read("198.51.100.7")).status, 200);
  assert.deepEqual(counted, [{ bucket: "authenticated-read", key: hash("user", "user_synthetic_reader") }]);
});
