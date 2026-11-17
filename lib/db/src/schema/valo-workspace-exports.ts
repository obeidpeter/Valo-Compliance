import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
export const valoWorkspaceExports = pgTable(
  "valo_workspace_exports",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    requesterId: text("requester_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    status: text("status", { enum: ["queued", "preparing", "interrupted", "ready", "cancelled", "expired"] })
      .notNull()
      .default("queued"),
    version: integer("version").notNull().default(1),
    queueId: uuid("queue_id").notNull().defaultRandom(),
    rowsProcessed: integer("rows_processed").notNull().default(0),
    bytesPrepared: bigint("bytes_prepared", { mode: "number" }).notNull().default(0),
    progressSection: text("progress_section"),
    attempts: integer("attempts").notNull().default(0),
    currentAttemptId: uuid("current_attempt_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    checksum: text("checksum"),
    size: bigint("size", { mode: "number" }),
    counts: jsonb("counts").$type<Record<string, number>>(),
    scope: text("scope"),
    errorCode: text("error_code"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("valo_workspace_export_identity").on(t.id, t.workspaceId),
    unique("valo_workspace_export_request").on(t.workspaceId, t.requesterId, t.requestKey),
    // A workspace has at most one export in progress.
    uniqueIndex("valo_workspace_export_one_active")
      .on(t.workspaceId)
      .where(sql`${t.status} in ('queued', 'preparing', 'interrupted')`),
    index("valo_workspace_export_expiry").on(t.expiresAt),
    index("valo_workspace_export_dispatch").on(t.status, t.updatedAt),
    check("valo_workspace_exports_attempts_check", sql`${t.attempts} BETWEEN 0 AND 5`),
    check("valo_workspace_exports_bytes_prepared_check", sql`${t.bytesPrepared} >= 0`),
    check(
      "valo_workspace_exports_check",
      sql`${t.status} <> 'ready' OR (${t.checksum} IS NOT NULL AND ${t.size} IS NOT NULL AND ${t.currentAttemptId} IS NOT NULL AND ${t.counts} IS NOT NULL)`,
    ),
    check("valo_workspace_exports_rows_processed_check", sql`${t.rowsProcessed} >= 0`),
    check("valo_workspace_exports_size_check", sql`${t.size} >= 0`),
    check(
      "valo_workspace_exports_status_check",
      sql`${t.status} IN ('queued', 'preparing', 'interrupted', 'ready', 'cancelled', 'expired')`,
    ),
    check("valo_workspace_exports_version_check", sql`${t.version} > 0`),
  ],
);
export const valoWorkspaceExportAttempts = pgTable(
  "valo_workspace_export_attempts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    jobId: uuid("job_id").notNull(),
    objectKey: text("object_key").notNull().unique(),
    status: text("status", { enum: ["reserved", "uploading", "ready", "cleanup"] })
      .notNull()
      .default("reserved"),
    cleanupCheckedAt: timestamp("cleanup_checked_at", { withTimezone: true }),
    nextCleanupAt: timestamp("next_cleanup_at", { withTimezone: true }).notNull().defaultNow(),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    cleanupErrorCode: text("cleanup_error_code", {
      enum: ["INVALID_PRIVATE_KEY", "PRIVACY_HOLD", "PRIVACY_REPLAY_OWNED", "STORAGE_DELETE_FAILED"],
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.jobId, t.workspaceId],
      foreignColumns: [valoWorkspaceExports.id, valoWorkspaceExports.workspaceId],
    }),
    index("valo_workspace_cleanup_due").on(t.nextCleanupAt, t.id),
    index("valo_workspace_export_cleanup").on(t.status, t.createdAt),
    index("valo_workspace_export_cleanup_round_robin").on(t.cleanupCheckedAt),
    check("valo_workspace_export_attempts_cleanup_attempts_check", sql`${t.cleanupAttempts} >= 0`),
    check(
      "valo_workspace_export_attempts_cleanup_error_code_check",
      sql`${t.cleanupErrorCode} IN ('INVALID_PRIVATE_KEY', 'PRIVACY_HOLD', 'PRIVACY_REPLAY_OWNED', 'STORAGE_DELETE_FAILED')`,
    ),
    check(
      "valo_workspace_export_attempts_status_check",
      sql`${t.status} IN ('reserved', 'uploading', 'ready', 'cleanup')`,
    ),
  ],
);
export const insertWorkspaceExportSchema = createInsertSchema(valoWorkspaceExports);
export type WorkspaceExport = typeof valoWorkspaceExports.$inferSelect;
