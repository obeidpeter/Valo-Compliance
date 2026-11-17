import { test } from "node:test";
import assert from "node:assert/strict";
import { digest, evaluatePublication } from "@workspace/valo-core";
import { heldSourceBundle } from "./valo-source-controls.fixtures";
test("source safety adds freshness, binding and sticky-hold checks without manufacturing eligibility", async () => {
  process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
  const { sourceTargetAllowed } = await import("./valo-source-state");
  const now = new Date("2026-11-15T10:00:00.000Z"),
    b = heldSourceBundle(now),
    h = b.sources[0]!.hash;
  assert.equal(evaluatePublication(b, now).decision, "hold");
  let held = false,
    bindings: Record<string, unknown>[] = [];
  const tx = { execute: async () => ({ rows: held ? [{ id: "held" }] : bindings }) };
  // The first query asks for impacts; return these separately from bindings.
  let reads = 0;
  const reader = {
    execute: async () => ({ rows: ++reads % 2 === 1 ? (held ? [{ id: "hold" }] : []) : bindings }),
  };
  const allowed = async () => {
    reads = 0;
    return sourceTargetAllowed(reader as never, "rule", "00000000-0000-4000-8000-000000000001", b, now);
  };
  assert.equal(await allowed(), false, "Unbound embedded evidence cannot authorize current use");
  bindings = [
    {
      bundle_source_id: b.sources[0]!.id,
      source_hash: h,
      url: b.sources[0]!.url,
      raw_hash: "raw",
      last_raw_hash: "raw",
      checked_at: new Date(+now - 1000),
      failure_code: null,
    },
  ];
  assert.equal(await allowed(), true, "Only the additional freshness guard passes; publication still holds");
  const two = structuredClone(b);
  two.sources.push({ ...two.sources[0]!, id: "second-passage", hash: digest("second retained passage") });
  bindings.push({ ...bindings[0], bundle_source_id: "second-passage", source_hash: two.sources[1]!.hash });
  reads = 0;
  assert.equal(
    await sourceTargetAllowed(reader as never, "rule", "00000000-0000-4000-8000-000000000001", two, now),
    true,
    "Distinct reviewed passage IDs can bind the same monitored URL without alias collapse",
  );
  bindings.splice(1);
  reads = 0;
  assert.equal(
    await sourceTargetAllowed(reader as never, "rule", "00000000-0000-4000-8000-000000000001", two, now),
    false,
  );
  for (const change of [
    { last_raw_hash: "changed" },
    { failure_code: "HTTP_FAILURE" },
    { checked_at: new Date(+now - 86400000) },
    { checked_at: new Date(+now + 1000) },
    { url: "https://example.test/other" },
    { source_hash: digest("other") },
  ]) {
    const original = { ...bindings[0] };
    Object.assign(bindings[0]!, change);
    assert.equal(await allowed(), false);
    bindings = [original];
  }
  held = true;
  assert.equal(await allowed(), false);
  held = false;
  const old = heldSourceBundle(new Date(+now - 30 * 86400000));
  assert.equal(
    await sourceTargetAllowed(tx as never, "rule", "00000000-0000-4000-8000-000000000001", old, now),
    false,
    "Monthly review is independent of a fresh fetch",
  );
  const operational = heldSourceBundle(new Date(+now - 89 * 86400000), false);
  assert.equal(
    await sourceTargetAllowed(
      { execute: async () => ({ rows: [] }) } as never,
      "content",
      "00000000-0000-4000-8000-000000000001",
      operational,
      now,
    ),
    true,
  );
  assert.equal(evaluatePublication(operational, now).decision, "hold");
});
test("staff inputs cannot supply publication, source URL, reviewer verdict or a role", async () => {
  process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
  const { sourceControlInput } = await import("./valo-source-controls");
  const input = {
    action: "watch_source",
    sourceId: "S01",
    requestKey: "00000000-0000-4000-8000-000000000001",
    reason: "Controlled source monitoring request",
  };
  assert.equal(sourceControlInput.safeParse(input).success, true);
  for (const addition of [
    { url: "http://127.0.0.1" },
    { review: "pass" },
    { role: "system" },
    { published: true },
    { snapshotId: "forged" },
  ])
    assert.equal(sourceControlInput.safeParse({ ...input, ...addition }).success, false);
  assert.equal(sourceControlInput.safeParse({ ...input, action: "publish" }).success, false);
});
