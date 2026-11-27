import {
  pgTable,
  boolean,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { sql } from "drizzle-orm";
import { valoDocumentRevisions } from "./valo-document-revisions";

export const valoExportJobs = pgTable(
  "valo_export_jobs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    documentId: uuid("document_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    revision: integer("revision").notNull(),
    format: text("format").notNull().$type<"docx" | "pdf">(),
    renderVersion: text("render_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    /** A finished file, made only of a complete version and printed without the draft notice
     * (docs/architecture/finished-file.md); otherwise a marked draft. */
    finished: boolean("finished").notNull().default(false),
    requestedBy: text("requested_by").notNull(),
    queueId: uuid("queue_id").notNull(),
    status: text("status")
      .notNull()
      .default("queued")
      .$type<"queued" | "running" | "retrying" | "ready" | "failed">(),
    attempts: integer("attempts").notNull().default(0),
    retryCycles: integer("retry_cycles").notNull().default(0),
    leaseRecoveries: integer("lease_recoveries").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_export_revision_format_unique").on(
      t.workspaceId,
      t.revisionId,
      t.format,
      t.renderVersion,
      t.finished,
    ),
    uniqueIndex("valo_export_workspace_unique").on(t.id, t.workspaceId),
    index("valo_export_dispatch_idx").on(t.status, t.createdAt),
    index("valo_export_workspace_document_idx").on(t.workspaceId, t.documentId, t.createdAt),
    foreignKey({
      columns: [t.revisionId, t.documentId, t.workspaceId],
      foreignColumns: [
        valoDocumentRevisions.id,
        valoDocumentRevisions.documentId,
        valoDocumentRevisions.workspaceId,
      ],
    }),
    check("valo_export_jobs_lease_recoveries_check", sql`${t.leaseRecoveries} >= 0`),
    workspaceRowPolicy(t.workspaceId),
  ],
);
