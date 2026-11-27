import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_FACTS } from "./checker";
import {
  CHECKER_HANDOFF_TTL_MS,
  clearCheckerHandoff,
  peekCheckerHandoff,
  stashCheckerHandoff,
} from "./checker-handoff";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    size: () => map.size,
  };
}

test("stashCheckerHandoff round-trips valid answers and clears on expiry or clearCheckerHandoff", () => {
  const store = memoryStorage();
  const t0 = 1_700_000_000_000;
  const payload = {
    facts: { ...EMPTY_FACTS, state: "Lagos" as const, employees: "6" },
    skipped: ["lga"],
    amountText: "2500000",
  };

  stashCheckerHandoff(payload, store, t0);
  assert.deepEqual(peekCheckerHandoff(store, t0 + 1000), payload);

  // Expired handoffs are rejected and removed.
  assert.equal(peekCheckerHandoff(store, t0 + CHECKER_HANDOFF_TTL_MS + 1), null);
  assert.equal(store.size(), 0);

  // Explicit clearing removes stored data immediately.
  stashCheckerHandoff(payload, store, t0);
  assert.equal(store.size(), 1);
  clearCheckerHandoff(store);
  assert.equal(peekCheckerHandoff(store, t0), null);
  assert.equal(store.size(), 0);
});

test("peekCheckerHandoff discards corrupt JSON or invalid shapes safely", () => {
  const store = memoryStorage();
  store.setItem("valo-checker-handoff-v1", "{bad-json");
  assert.equal(peekCheckerHandoff(store), null);
  assert.equal(store.size(), 0);

  store.setItem("valo-checker-handoff-v1", JSON.stringify({ v: 2, savedAt: Date.now() }));
  assert.equal(peekCheckerHandoff(store), null);
  assert.equal(store.size(), 0);
});
