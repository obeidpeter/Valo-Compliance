import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * ADM-009 (docs/architecture/audit-trail.md): the hourly count of every history. The database keeps
 * each history's digest as it is written; this recounts the rows in one snapshot and keeps which digests
 * no longer match, which a change made with the triggers off leaves behind. The worker asks every minute;
 * it counts only when no count is under 55 minutes old, so several workers count once an hour in all.
 */
export async function countHistories(database: Pick<typeof db, "transaction"> = db) {
  return database.transaction(
    async (tx) => {
      const recent = await tx.execute(
        sql`SELECT 1 FROM valo_history_checks WHERE checked_at > now() - interval '55 minutes' LIMIT 1`,
      );
      if (recent.rows.length > 0) return { counted: false as const };
      const kept = await tx.execute<{ mismatched: string[] }>(sql`
        INSERT INTO valo_history_checks (mismatched)
        SELECT COALESCE(array_agg(name ORDER BY name), '{}')
        FROM (SELECT DISTINCT name FROM valo_history_digest_mismatches() AS name) found
        RETURNING mismatched`);
      return { counted: true as const, mismatched: kept.rows[0]?.mismatched ?? [] };
    },
    // The rows and their digests are read in one snapshot, so a write in flight is in both or neither.
    { isolationLevel: "repeatable read" },
  );
}
