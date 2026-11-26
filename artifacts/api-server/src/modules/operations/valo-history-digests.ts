import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * ADM-009 (docs/architecture/audit-trail.md): each write to a history adds its change to the history's
 * digest as a row of its own, so no writer waits on a row another writer holds. Removing the changes folds
 * them into the digest's rows in the same statement, and leaves every digest as it was. Before the
 * migration that adds them (20261126174600), every change went to the digest's rows, and there is nothing
 * to fold.
 */
export async function foldHistoryDigestChanges(database: Pick<typeof db, "execute"> = db) {
  const present = await database.execute<{ present: boolean }>(
    sql`SELECT to_regclass('public.valo_history_digest_changes') IS NOT NULL AS present`,
  );
  if (!present.rows[0]?.present) return 0;
  const folded = await database.execute(sql`DELETE FROM valo_history_digest_changes`);
  return folded.rowCount ?? 0;
}

const RECENT_COUNT = sql`SELECT 1 FROM valo_history_checks WHERE checked_at > now() - interval '55 minutes' LIMIT 1`;

/**
 * ADM-009: the hourly count of every history. The database keeps each history's digest as it is written;
 * this recounts the rows in one snapshot and keeps which digests no longer match, which a change made with
 * the triggers off leaves behind. The worker asks every minute; it counts only when no count is under 55
 * minutes old, so several workers count once an hour in all. It folds the changes in first, so they stay
 * few.
 */
export async function countHistories(database: Pick<typeof db, "transaction" | "execute"> = db) {
  if ((await database.execute(RECENT_COUNT)).rows.length > 0) return { counted: false as const };
  await foldHistoryDigestChanges(database);
  return database.transaction(
    async (tx) => {
      if ((await tx.execute(RECENT_COUNT)).rows.length > 0) return { counted: false as const };
      const kept = await tx.execute<{ mismatched: string[] }>(sql`
        INSERT INTO valo_history_checks (mismatched)
        SELECT COALESCE(array_agg(name ORDER BY name), '{}')
        FROM (SELECT DISTINCT name FROM valo_history_digest_mismatches() AS name) found
        RETURNING mismatched`);
      return { counted: true as const, mismatched: kept.rows[0]?.mismatched ?? [] };
    },
    // The rows and their digests are read in one snapshot, so a write in flight, or a fold, is in both or
    // neither.
    { isolationLevel: "repeatable read" },
  );
}
