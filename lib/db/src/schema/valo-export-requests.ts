import { pgTable, uuid, text, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { createInsertSchema } from "drizzle-zod";
import { valoExportJobs } from "./valo-exports";
export const valoExportRequests = pgTable(
  "valo_export_requests",
  {
    workspaceId: uuid("workspace_id").notNull(),
    key: uuid("key").notNull(),
    jobId: uuid("job_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
  },
  (t) => [
    uniqueIndex("valo_export_request_key_unique").on(t.workspaceId, t.key),
    foreignKey({
      columns: [t.jobId, t.workspaceId],
      foreignColumns: [valoExportJobs.id, valoExportJobs.workspaceId],
    }),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoExportRequestSchema = createInsertSchema(valoExportRequests);
export type ValoExportRequest = typeof valoExportRequests.$inferSelect;
