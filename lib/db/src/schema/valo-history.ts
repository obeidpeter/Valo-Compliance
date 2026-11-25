import {
  pgTable,
  text,
  smallint,
  bigint,
  numeric,
  uuid,
  timestamp,
  primaryKey,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * ADM-009 (docs/architecture/audit-trail.md): a digest of every history, kept by the database itself. A
 * trigger after each write adds the new row's hash and takes away the old row's, so a change made with
 * the triggers off leaves the digest behind. Sixteen shards a history keep writers from waiting on one row.
 */
export const valoHistoryDigests = pgTable(
  "valo_history_digests",
  {
    tableName: text("table_name").notNull(),
    shard: smallint("shard").notNull(),
    rowCount: bigint("row_count", { mode: "number" }).notNull(),
    hashSum: numeric("hash_sum").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tableName, t.shard] }),
    check("valo_history_digests_shard_check", sql`${t.shard} BETWEEN 0 AND 15`),
  ],
);

/** Each hourly count of the histories, and which digests it found no longer matching their rows. */
export const valoHistoryChecks = pgTable(
  "valo_history_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    mismatched: text("mismatched").array().notNull(),
  },
  (t) => [index("valo_history_checks_checked_idx").on(t.checkedAt)],
);
