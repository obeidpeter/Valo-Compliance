import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const skip = process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only";
let opened: { end(): Promise<void> } | undefined;
async function database() {
  const loaded = await import("@workspace/db");
  opened = loaded.pool;
  return loaded;
}
after(async () => {
  await opened?.end();
});

// ADM-009 (docs/architecture/audit-trail.md): the worker's hourly count of every history, on the real
// database. Other steps may change rows in replica mode as they clean up, so this shows how a count is
// kept and read, not that every digest matches; the migration test shows each mismatch the count finds.
test(
  "the hourly count keeps what it found once an hour, the alert reads the latest count, and a kept count never changes",
  { skip },
  async () => {
    const { pool } = await database();
    const { countHistories } = await import("./valo-history-digests");
    const { readinessQueries } = await import("./valo-operations");
    const kept = async () =>
      Number((await pool.query("SELECT count(*) AS n FROM valo_history_checks")).rows[0].n);
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
  },
);

// Each write to a history adds its change to the history's digest as a row of its own, which no other
// writer waits on, and the count folds the changes in first. The migration test shows that folding
// changes no digest; this shows the worker's own code removes the changes it folds.
test(
  "a write to a history adds its change as a row of its own, and the worker's fold takes it into the digest's rows",
  { skip },
  async () => {
    const { pool } = await database();
    const { foldHistoryDigestChanges } = await import("./valo-history-digests");
    const { resolveWorkspace } = await import("../workspaces");
    const actor = await resolveWorkspace(`synthetic-history-fold-${randomUUID()}`);
    // Every column is given, so the event's hash, read in UTC as the digest's trigger reads it, is known.
    const event = JSON.stringify({
      id: randomUUID(),
      workspace_id: actor.workspaceId,
      actor_id: "synthetic-history-fold",
      action: "document.created",
      entity_id: randomUUID(),
      created_at: new Date().toISOString(),
    });
    const session = await pool.connect();
    let hash: string;
    try {
      await session.query("BEGIN");
      await session.query("SET LOCAL timezone = 'UTC'");
      hash = (
        await session.query<{ hash: string }>(
          "SELECT valo_history_row_hash(to_jsonb(jsonb_populate_record(NULL::valo_events, $1::jsonb)))::text AS hash",
          [event],
        )
      ).rows[0]!.hash;
      await session.query("COMMIT");
    } finally {
      session.release();
    }
    const changes = async () =>
      Number(
        (
          await pool.query(
            "SELECT count(*) AS n FROM valo_history_digest_changes WHERE table_name='valo_events' AND row_count=1 AND hash_sum=$1::numeric",
            [hash],
          )
        ).rows[0].n,
      );
    await pool.query(
      "INSERT INTO valo_events SELECT * FROM jsonb_populate_record(NULL::valo_events, $1::jsonb)",
      [event],
    );
    assert.equal(await changes(), 1, "the event's change is a row of its own");
    assert.ok((await foldHistoryDigestChanges()) >= 1);
    assert.equal(await changes(), 0, "the fold took the change into the digest's rows");
  },
);
