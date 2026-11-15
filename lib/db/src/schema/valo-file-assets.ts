import { pgTable, uuid, text, integer, timestamp, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoExportJobs } from "./valo-exports";
export const valoFileAssets = pgTable("valo_file_assets", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  jobId: uuid("job_id").notNull(),
  objectKey: text("object_key").notNull(),
  checksum: text("checksum").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  retentionAt: timestamp("retention_at",{withTimezone:true}),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
}, t => [
  uniqueIndex("valo_export_file_unique").on(t.jobId),
  foreignKey({columns:[t.jobId,t.workspaceId],foreignColumns:[valoExportJobs.id,valoExportJobs.workspaceId]}),
]);
export const insertValoFileAssetSchema = createInsertSchema(valoFileAssets);
export type ValoFileAsset = typeof valoFileAssets.$inferSelect;
