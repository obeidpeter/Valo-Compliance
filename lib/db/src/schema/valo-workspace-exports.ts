import {pgTable,uuid,text,integer,bigint,jsonb,timestamp,uniqueIndex,foreignKey} from "drizzle-orm/pg-core";
import {createInsertSchema} from "drizzle-zod";
import {valoWorkspaces} from "./valo-workspaces";
export const valoWorkspaceExports=pgTable("valo_workspace_exports",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  requesterId:text("requester_id").notNull(),requestKey:uuid("request_key").notNull(),
  status:text("status",{enum:["queued","preparing","interrupted","ready","cancelled","expired"]}).notNull().default("queued"),
  version:integer("version").notNull().default(1),queueId:uuid("queue_id").notNull().defaultRandom(),
  rowsProcessed:integer("rows_processed").notNull().default(0),bytesPrepared:bigint("bytes_prepared",{mode:"number"}).notNull().default(0),
  progressSection:text("progress_section"),
  attempts:integer("attempts").notNull().default(0),currentAttemptId:uuid("current_attempt_id"),
  leaseUntil:timestamp("lease_until",{withTimezone:true}),checksum:text("checksum"),
  size:bigint("size",{mode:"number"}),counts:jsonb("counts").$type<Record<string,number>>(),scope:text("scope"),
  errorCode:text("error_code"),snapshotAt:timestamp("snapshot_at",{withTimezone:true}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_workspace_export_identity").on(t.id,t.workspaceId),
  uniqueIndex("valo_workspace_export_request").on(t.workspaceId,t.requesterId,t.requestKey)]);
export const valoWorkspaceExportAttempts=pgTable("valo_workspace_export_attempts",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull(),jobId:uuid("job_id").notNull(),
  objectKey:text("object_key").notNull().unique(),
  status:text("status",{enum:["reserved","uploading","ready","cleanup"]}).notNull().default("reserved"),
  cleanupCheckedAt:timestamp("cleanup_checked_at",{withTimezone:true}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[foreignKey({columns:[t.jobId,t.workspaceId],foreignColumns:[valoWorkspaceExports.id,valoWorkspaceExports.workspaceId]})]);
export const insertWorkspaceExportSchema=createInsertSchema(valoWorkspaceExports);
export type WorkspaceExport=typeof valoWorkspaceExports.$inferSelect;
