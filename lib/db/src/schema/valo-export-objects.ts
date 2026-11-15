import { pgTable,text,uuid,integer,timestamp,index,foreignKey } from "drizzle-orm/pg-core";
import { valoExportJobs } from "./valo-exports";

/** Reservation precedes network I/O; cleanup tombstones survive unsuccessful uploads. */
export const valoExportObjects=pgTable("valo_export_objects",{
  objectKey:text("object_key").primaryKey(),
  workspaceId:uuid("workspace_id").notNull(),
  jobId:uuid("job_id").notNull(),
  queueId:uuid("queue_id").notNull(),
  state:text("state").notNull().$type<"pending"|"retained"|"cleanup">(),
  cleanupAttempts:integer("cleanup_attempts").notNull().default(0),
  nextCleanupAt:timestamp("next_cleanup_at",{withTimezone:true}).notNull().defaultNow(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  foreignKey({columns:[t.jobId,t.workspaceId],foreignColumns:[valoExportJobs.id,valoExportJobs.workspaceId]}),
  index("valo_export_object_cleanup_idx").on(t.state,t.nextCleanupAt),
]);
