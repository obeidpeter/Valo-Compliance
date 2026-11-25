import test from "node:test";
import assert from "node:assert/strict";

// ADM-009 (docs/architecture/audit-trail.md): the worker's hourly count of every history, on the real
// database. Other steps may change rows in replica mode as they clean up, so this shows how a count is
// kept and read, not that every digest matches; the migration test shows each mismatch the count finds.
test(
  "the hourly count keeps what it found once an hour, the alert reads the latest count, and a kept count never changes",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only" },
  async () => {
    const { pool } = await import("@workspace/db");
    const { countHistories } = await import("./valo-history-digests");
    const { readinessQueries } = await import("./valo-operations");
    const kept = async () =>
      Number((await pool.query("SELECT count(*) AS n FROM valo_history_checks")).rows[0].n);
    try {
      const first = await countHistories();
      const latest = (
        await pool.query<{ mismatched: string[] }>(
          "SELECT mismatched FROM valo_history_checks ORDER BY checked_at DESC LIMIT 1",
        )
      ).rows[0]!;
      // A count kept within the hour, by an earlier run against the same database, stands in its place.
      if (first.counted) {
        assert.ok(
          first.mismatched.every((name) => /^valo_[a-z0-9_]+$/.test(name)),
          first.mismatched.join(", "),
        );
        assert.deepEqual(latest.mismatched, first.mismatched);
      }
      // Within the hour the next call counts nothing and keeps nothing.
      const before = await kept();
      assert.deepEqual(await countHistories(), { counted: false });
      assert.equal(await kept(), before);
      // The alert reads the latest count: how many histories it found mismatched.
      assert.equal(
        Number((await pool.query(readinessQueries.historyIntegrity)).rows[0].value),
        latest.mismatched.length,
      );
      await assert.rejects(
        pool.query("DELETE FROM valo_history_checks"),
        /A history count is never changed or removed/,
      );
    } finally {
      await pool.end();
    }
  },
);
