import assert from "node:assert/strict";
import { test } from "node:test";
import { quotaPolicy, quotaSubjectHash } from "./valo-quota-policy";

test("quota defaults preserve the requested initial ceilings", () => {
  assert.deepEqual(quotaPolicy, {
    "public-support":3,"public-support-day":20,
    "anonymous-read":60, "authenticated-read":120, "customer-ai":5, "checkout-create":10, "export-create":10,
    "profile-write":20,"profile-write-day":200,"document-write":30,"document-write-day":600,
    "support-write":3,"support-write-day":20,
    "refund-create":10,"refund-create-day":50,
  });
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
