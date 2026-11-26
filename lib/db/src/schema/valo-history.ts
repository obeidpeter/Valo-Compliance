import {
  pgTable,
  text,
  smallint,
  bigint,
  bigserial,
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
 * the triggers off leaves the digest behind. A history's digest is its rows here and its changes not yet
 * folded in (valo_history_digest_changes) together, in sixteen shards.
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

/**
 * Each write to a history adds its change to the history's digest here, as a row of its own, so no writer
 * waits on a row another writer holds. Removing changes folds them into valo_history_digests; the hourly
 * count folds them all first.
 */
export const valoHistoryDigestChanges = pgTable(
  "valo_history_digest_changes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tableName: text("table_name").notNull(),
    shard: smallint("shard").notNull(),
    rowCount: bigint("row_count", { mode: "number" }).notNull(),
    hashSum: numeric("hash_sum").notNull(),
  },
  (t) => [check("valo_history_digest_changes_shard_check", sql`${t.shard} BETWEEN 0 AND 15`)],
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
