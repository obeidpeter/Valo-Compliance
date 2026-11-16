import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const valoSourceSnapshots = pgTable(
  "valo_source_snapshots",
  {
    id: uuid("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    status: text("status").notNull(),
    httpStatus: integer("http_status"),
    mime: text("mime"),
    rawChecksum: text("raw_checksum"),
    textChecksum: text("text_checksum"),
    rawObjectKey: text("raw_object_key"),
    textObjectKey: text("text_object_key"),
    bytes: integer("bytes"),
    extractionVersion: text("extraction_version").notNull(),
    failureCode: text("failure_code"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("valo_source_snapshot_source_date").on(t.sourceId, t.attemptedAt)],
);
export const insertValoSourceSnapshotSchema = createInsertSchema(valoSourceSnapshots);
export type ValoSourceSnapshot = typeof valoSourceSnapshots.$inferSelect;
