import test from "node:test";
import assert from "node:assert/strict";
import { guardNestedConnections } from "./nested-connection-guard";

test("only connections taken while a transaction holds one are recorded", async () => {
  const pool = {
    connect: async () => ({ release() {} }),
    query: async (_text: string) => ({ rows: [] }),
  };
  // Shaped like drizzle: the transaction takes its connection, then runs the callback.
  const db = {
    transaction: async <T>(run: (tx: { query: () => Promise<void> }) => Promise<T>) => {
      await pool.connect();
      return run({ query: async () => undefined });
    },
  };
  const originals = { transaction: db.transaction, connect: pool.connect, query: pool.query };
  const guard = guardNestedConnections({ db, pool });
  try {
    await pool.query("before any transaction");
    await db.transaction(async (tx) => tx.query());
    await db.transaction(async () => {
      await pool.query("a second connection while holding the first");
    });
    await db.transaction(async () => {
      await db.transaction(async () => undefined);
    });
    // Another flow may use the pool while a transaction is open elsewhere.
    let release!: () => void;
    const open = db.transaction(() => new Promise<void>((resolve) => (release = resolve)));
    await pool.query("concurrent flow without a transaction");
    release();
    await open;
    await pool.query("after the transaction");
    assert.equal(guard.violations.length, 2, guard.violations.join("\n"));
    assert.match(
      guard.violations[0]!,
      /^pool\.query inside the transaction opened\n.*nested-connection-guard\.test\.ts/s,
    );
    assert.match(guard.violations[1]!, /^db\.transaction inside the transaction opened/);
  } finally {
    guard.restore();
  }
  assert.equal(db.transaction, originals.transaction);
  assert.equal(pool.connect, originals.connect);
  assert.equal(pool.query, originals.query);
});
