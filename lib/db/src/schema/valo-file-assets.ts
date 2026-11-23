import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index, foreignKey } from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { createInsertSchema } from "drizzle-zod";
import { valoExportJobs } from "./valo-exports";
export const valoFileAssets = pgTable(
  "valo_file_assets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    jobId: uuid("job_id").notNull(),
    objectKey: text("object_key").notNull(),
    checksum: text("checksum").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    retentionAt: timestamp("retention_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_export_file_unique").on(t.jobId),
    index("valo_file_assets_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("valo_file_assets_retention_idx").on(t.retentionAt),
    foreignKey({
      columns: [t.jobId, t.workspaceId],
      foreignColumns: [valoExportJobs.id, valoExportJobs.workspaceId],
    }),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoFileAssetSchema = createInsertSchema(valoFileAssets);
export type ValoFileAsset = typeof valoFileAssets.$inferSelect;
