import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, primaryKey, index, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const valoRateBuckets = pgTable("valo_rate_buckets", {
  bucket: text("bucket").notNull(),
  subjectHash: text("subject_hash").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  usedCount: integer("used_count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [
  primaryKey({ columns: [t.bucket, t.subjectHash, t.windowStartedAt] }),
  index("valo_rate_buckets_expiry_idx").on(t.expiresAt),
  check("valo_rate_buckets_positive", sql`${t.usedCount} > 0`),
]);
export const insertValoRateBucketSchema = createInsertSchema(valoRateBuckets);
export type ValoRateBucket = typeof valoRateBuckets.$inferSelect;
