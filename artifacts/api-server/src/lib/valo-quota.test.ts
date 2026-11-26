import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { SETTINGS } from "../platform/settings";
import {
  limitSettingName,
  quotaLimit,
  quotaPolicy,
  quotaSubjectHash,
  requestLimits,
  type QuotaBucket,
} from "./valo-quota-policy";

test("quota defaults preserve the requested initial ceilings", () => {
  assert.deepEqual(quotaPolicy, {
    "public-support": 3,
    "public-support-day": 20,
    // Public support requests from one network address, and from everyone together: these ceilings
    // were written where they were counted, and kept their values when they joined the table.
    "public-support-socket": 20,
    "public-support-socket-day": 100,
    "public-support-all": 100,
    "public-support-all-day": 1000,
    "anonymous-read": 60,
    "authenticated-read": 120,
    // The shared ceiling over every page render's reads (middlewares/valo-quota.ts), added with the
    // per-visitor count of page renders; it raises none of the ceilings above.
    "page-render-read": 600,
    "customer-ai": 5,
    "checkout-create": 10,
    // Checkout's account limit has its own counter, so the day's count is never read against the
    // minute's ceiling (SEC-005).
    "checkout-create-day": 100,
    "export-create": 10,
    "profile-write": 20,
    "profile-write-day": 200,
    "document-write": 30,
    "document-write-day": 600,
    "support-write": 3,
    "support-write-day": 20,
    // A member of staff's support actions, likewise written where they were counted until now.
    "staff-support-write": 20,
    "staff-support-write-day": 200,
    "refund-create": 10,
    "refund-create-day": 50,
  });
});

test("each ceiling is a setting of its own, today's ceiling by default, and only a whole number from 1 to 10,000 is accepted (SEC-005)", () => {
  const buckets = Object.keys(quotaPolicy) as QuotaBucket[];
  // Every bucket's setting is registered, and the example the registry gives is today's ceiling.
  for (const bucket of buckets) {
    const definition = SETTINGS[limitSettingName(bucket)];
    assert.equal(definition.group, "Request limits", bucket);
    assert.equal(definition.example, String(quotaPolicy[bucket]), bucket);
  }
  assert.equal(limitSettingName("public-support-socket-day"), "VALO_LIMIT_PUBLIC_SUPPORT_SOCKET_DAY");
  const names = buckets.map(limitSettingName);
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.deepEqual(requestLimits(), quotaPolicy);
    // A value set replaces today's ceiling, for that bucket alone; an empty one is unset.
    process.env.VALO_LIMIT_CUSTOMER_AI = "2";
    process.env.VALO_LIMIT_ANONYMOUS_READ = "10000";
    process.env.VALO_LIMIT_STAFF_SUPPORT_WRITE = "1";
    process.env.VALO_LIMIT_REFUND_CREATE = "";
    assert.deepEqual(requestLimits(), {
      ...quotaPolicy,
      "customer-ai": 2,
      "anonymous-read": 10000,
      "staff-support-write": 1,
    });
    assert.equal(quotaLimit("customer-ai"), 2);
    // Anything but a whole number from 1 to 10,000, written plainly, is refused, naming the setting.
    for (const value of ["0", "10001", "-1", "1.5", "05", " 5", "5 ", "1e3", "0x10", "ten"]) {
      process.env.VALO_LIMIT_CUSTOMER_AI = value;
      const refusal = { message: "RequestLimitSettingInvalid: VALO_LIMIT_CUSTOMER_AI" };
      assert.throws(() => requestLimits(), refusal, JSON.stringify(value));
      assert.throws(() => quotaLimit("customer-ai"), refusal, JSON.stringify(value));
    }
  } finally {
    for (const [name, value] of Object.entries(before))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});

test("the API stops as it starts on a request limit outside its bounds, before it listens (SEC-005)", () => {
  // The real entry, with a database address nothing answers: it must stop before it uses one.
  const child = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: resolve(import.meta.dirname, "../.."),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "development",
      PORT: "58411",
      DATABASE_URL: "postgresql://synthetic@127.0.0.1:9/synthetic",
      VALO_LIMIT_ANONYMOUS_READ: "0",
    },
    encoding: "utf8",
    // It stops in seconds; one that listens instead is stopped here, and fails.
    timeout: 30_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stderr.slice(-2000));
  assert.match(child.stderr, /RequestLimitSettingInvalid: VALO_LIMIT_ANONYMOUS_READ/);
  assert.doesNotMatch(child.stdout + child.stderr, /Server listening/);
});
test("quota subjects are pseudonymised, domain-separated and keyed", () => {
  const synthetic = "synthetic-unit-test-only-secret-00001";
  const hash = quotaSubjectHash(synthetic, "ip", "192.0.2.1");
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, quotaSubjectHash(synthetic, "user", "192.0.2.1"));
  assert.notEqual(hash, quotaSubjectHash(synthetic + "rotation", "ip", "192.0.2.1"));
  assert.equal(hash, quotaSubjectHash(synthetic, "ip", "192.0.2.1"));
});
test("missing quota configuration fails rather than silently using memory or an unkeyed IP hash", () => {
  assert.throws(() => quotaSubjectHash(undefined, "ip", "192.0.2.1"), /Unavailable/);
  assert.throws(() => quotaSubjectHash("short", "user", "synthetic"), /Unavailable/);
});
