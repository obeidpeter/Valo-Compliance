import assert from "node:assert/strict";
import test from "node:test";
import { randomUuid, resolveIdempotencyKey, type IdempotencySlot } from "./idempotency";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("randomUuid produces distinct valid UUID v4 values", () => {
  const first = randomUuid();
  const second = randomUuid();
  assert.match(first, UUID_V4);
  assert.match(second, UUID_V4);
  assert.notEqual(first, second);
});

test("resolveIdempotencyKey reuses the key on identical retries and rotates when payload changes or resets", () => {
  let counter = 0;
  const makeUuid = () => `00000000-0000-4000-8000-00000000000${++counter}`;

  let slot: IdempotencySlot = null;
  slot = resolveIdempotencyKey(slot, { kind: "correction", message: "Fix business name" }, makeUuid);
  assert.equal(slot.key, "00000000-0000-4000-8000-000000000001");

  // Retry of the exact same payload keeps the same key.
  const retry = resolveIdempotencyKey(slot, { kind: "correction", message: "Fix business name" }, makeUuid);
  assert.equal(retry.key, slot.key);
  assert.equal(counter, 1);

  // Editing any field mints a fresh key instead of re-sending the stale key.
  const edited = resolveIdempotencyKey(
    retry,
    { kind: "correction", message: "Fix business name and address" },
    makeUuid,
  );
  assert.equal(edited.key, "00000000-0000-4000-8000-000000000002");

  // Clearing the slot after confirmed success mints a new key even for the same payload.
  const fresh = resolveIdempotencyKey(
    null,
    { kind: "correction", message: "Fix business name and address" },
    makeUuid,
  );
  assert.equal(fresh.key, "00000000-0000-4000-8000-000000000003");
});
