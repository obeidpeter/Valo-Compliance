import { pgTable, uuid, text, integer, timestamp, uniqueIndex, foreignKey,check } from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { valoExportJobs } from "./valo-exports";
import {valoWorkspaceExports} from "./valo-workspace-exports";
export const valoFileAssets = pgTable("valo_file_assets", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  jobId: uuid("job_id"),
  workspaceExportJobId:uuid("workspace_export_job_id"),
  objectKey: text("object_key").notNull(),
  checksum: text("checksum").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  retentionAt: timestamp("retention_at",{withTimezone:true}),
  withdrawnAt:timestamp("withdrawn_at",{withTimezone:true}),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
}, t => [
  uniqueIndex("valo_export_file_unique").on(t.jobId),
  uniqueIndex("valo_workspace_export_file_unique").on(t.workspaceExportJobId),
  foreignKey({columns:[t.jobId,t.workspaceId],foreignColumns:[valoExportJobs.id,valoExportJobs.workspaceId]}),
  foreignKey({name:"valo_file_asset_workspace_job_fk",columns:[t.workspaceExportJobId,t.workspaceId],
    foreignColumns:[valoWorkspaceExports.id,valoWorkspaceExports.workspaceId]}),
  check("valo_file_asset_exact_job",sql`(${t.jobId} IS NULL) <> (${t.workspaceExportJobId} IS NULL)`),
  check("valo_file_asset_withdrawal_scope",sql`${t.withdrawnAt} IS NULL OR ${t.workspaceExportJobId} IS NOT NULL`),
]);
export const insertValoFileAssetSchema = createInsertSchema(valoFileAssets);
export type ValoFileAsset = typeof valoFileAssets.$inferSelect;
