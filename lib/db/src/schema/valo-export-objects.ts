import { pgTable,text,uuid,integer,timestamp,index,foreignKey,check } from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import { valoExportJobs } from "./valo-exports";
import {valoWorkspaceExports} from "./valo-workspace-exports";

/** Reservation precedes network I/O; cleanup tombstones survive unsuccessful uploads. */
export const valoExportObjects=pgTable("valo_export_objects",{
  objectKey:text("object_key").primaryKey(),
  workspaceId:uuid("workspace_id").notNull(),
  jobId:uuid("job_id"),
  workspaceExportJobId:uuid("workspace_export_job_id"),
  queueId:uuid("queue_id").notNull(),
  state:text("state").notNull().$type<"pending"|"retained"|"cleanup">(),
  cleanupAttempts:integer("cleanup_attempts").notNull().default(0),
  nextCleanupAt:timestamp("next_cleanup_at",{withTimezone:true}).notNull().defaultNow(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  foreignKey({columns:[t.jobId,t.workspaceId],foreignColumns:[valoExportJobs.id,valoExportJobs.workspaceId]}),
  foreignKey({name:"valo_export_object_workspace_job_fk",columns:[t.workspaceExportJobId,t.workspaceId],
    foreignColumns:[valoWorkspaceExports.id,valoWorkspaceExports.workspaceId]}),
  check("valo_export_object_exact_job",sql`(${t.jobId} IS NULL) <> (${t.workspaceExportJobId} IS NULL)`),
  index("valo_export_object_cleanup_idx").on(t.state,t.nextCleanupAt),
]);
