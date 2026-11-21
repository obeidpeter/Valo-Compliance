import test from "node:test";
import assert from "node:assert/strict";
import { narrowOperationalPolicy, publicationCheckTime } from "../publication/operational-restrictions";
import { operationalPolicy } from "../publication/operational-policy";
import { lifecycleSeedUrl, assertLifecycleRunDatabase } from "./editorial-lifecycle-sandbox";
import {
  dispatchEditorialLifecycle,
  lifecycleCaseIds,
  lifecyclePublisherUrl,
} from "./editorial-lifecycle-dispatch";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "@workspace/valo-core";

test("optional scope reductions cannot expand policy or modify existing policy input", async () => {
  const { policy } = await operationalPolicy(),
    before = structuredClone(policy);
  const narrowed = narrowOperationalPolicy(policy, {
    version: "test-1",
    reason: "Controlled exclusion of one previously authorised scope",
    excludedClasses: [policy.allowedClasses[0]!],
  });
  assert.ok(narrowed.allowedClasses.length < policy.allowedClasses.length);
  assert.notEqual(narrowed.hash, policy.hash);
  assert.deepEqual(policy, before);
  assert.throws(
    () =>
      narrowOperationalPolicy(policy, {
        version: "bad",
        reason: "Controlled attempted expansion should be rejected",
        allowedClasses: ["bespoke_opinion"],
      }),
    /Unrecognized key/,
  );
  assert.throws(
    () =>
      narrowOperationalPolicy(policy, {
        version: "bad",
        reason: "Controlled unknown class should be rejected",
        excludedClasses: ["new_scope"],
      }),
    /OUTSIDE_AUTHORISED_SCOPE/,
  );
  assert.deepEqual(
    narrowOperationalPolicy(policy, {
      version: "pause",
      reason: "Controlled temporary complete publication suspension",
      suspended: true,
    }).allowedClasses,
    [],
  );
});
test("publication time can advance but cannot make expired evidence fresh", () => {
  const now = new Date("2026-11-15T00:00:00Z");
  assert.equal(+publicationCheckTime(new Date("2020-01-01"), now), +now);
  assert.equal(+publicationCheckTime(new Date("2030-01-01"), now), +new Date("2030-01-01"));
  assert.throws(() => publicationCheckTime(new Date("invalid"), now), /INVALID_PUBLICATION_CHECK_TIME/);
});
test("destructive lifecycle tests reject native, remote, ambiguous and same-application databases", () => {
  const seed = "postgresql://fixture:fixture@localhost:5432/valo_lifecycle_seed_1234567890abcdef";
  assert.equal(lifecycleSeedUrl(seed).hostname, "localhost");
  for (const url of [
    undefined,
    "postgresql://fixture:fixture@db.remote/valo_lifecycle_seed_1234567890abcdef",
    "postgresql://fixture:fixture@localhost/production",
    "postgresql://fixture:fixture@localhost/valo_lifecycle_seed_1234567890abcdef?options=-csearch_path=public",
  ])
    assert.throws(() => lifecycleSeedUrl(url));
  assert.throws(() => lifecycleSeedUrl(seed, seed), /MUST_DIFFER/);
  assert.throws(
    () => assertLifecycleRunDatabase(seed, "valo_lifecycle_seed_1234567890abcdef"),
    /NATIVE_DATABASE_FORBIDDEN/,
  );
  assertLifecycleRunDatabase(
    "postgresql://fixture:fixture@localhost/valo_lifecycle_run_" + "a".repeat(32),
    "valo_lifecycle_run_" + "a".repeat(32),
  );
});
test("a lifecycle copy is released through the publisher login of its own server, or not at all", () => {
  const copy =
    "postgresql://owner:synthetic@127.0.0.1:5544/valo_lifecycle_run_0123456789abcdef0123456789abcdef";
  const seedPublisher =
    "postgresql://valo_publisher_login:synthetic@127.0.0.1:5544/valo_lifecycle_seed_0123456789abcdef";
  // The seed server's publisher connection, with the copy's database name.
  assert.equal(
    lifecyclePublisherUrl(seedPublisher, copy),
    "postgresql://valo_publisher_login:synthetic@127.0.0.1:5544/valo_lifecycle_run_0123456789abcdef0123456789abcdef",
  );
  // None configured, or one that cannot be read: the copy gets no publisher connection, so a
  // release in it fails as unavailable and is never run on the application's own login.
  assert.equal(lifecyclePublisherUrl(undefined, copy), undefined);
  assert.equal(lifecyclePublisherUrl("not a connection string", copy), undefined);
});

test("original ten lifecycle case IDs route to a genuine-baseline prerequisite without calls or fabricated pass", async () => {
  const before = {
    mode: process.env.NODE_ENV,
    deployment: process.env.REPLIT_DEPLOYMENT,
    seed: process.env.VALO_EDITORIAL_LIFECYCLE_DATABASE_URL,
  };
  try {
    process.env.NODE_ENV = "development";
    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.VALO_EDITORIAL_LIFECYCLE_DATABASE_URL;
    for (const id of lifecycleCaseIds) {
      const result = await dispatchEditorialLifecycle(id, "11111111-1111-4111-8111-111111111111");
      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "ISOLATED_GENUINE_LIFECYCLE_BASELINE_NOT_CONFIGURED");
      assert.equal(result.actualProviderCalls, 0);
      assert.equal(result.formalCaseAccepted, false);
    }
  } finally {
    for (const [key, value] of [
      ["NODE_ENV", before.mode],
      ["REPLIT_DEPLOYMENT", before.deployment],
      ["VALO_EDITORIAL_LIFECYCLE_DATABASE_URL", before.seed],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
test("original editorial60 corpus remains exact and all ten lifecycle cases keep their original preconditions", async () => {
  const bytes = await readFile(
    resolve(import.meta.dirname, "../../../../..", "docs/evaluation-candidates/editorial.json"),
  );
  assert.equal(sha256(bytes), "0ab6541ff3336e886ef42efff1d1f9ad38bcd2df0cdec65d62f50327c38e9f9c");
  const corpus = JSON.parse(bytes.toString());
  assert.equal(corpus.cases.length, 60);
  for (const id of lifecycleCaseIds) {
    const c = corpus.cases.find((x: { id: string }) => x.id === id);
    assert.ok(c);
    assert.equal(c.requiresProviderRun, false);
    assert.ok(c.preconditions.length);
  }
});
