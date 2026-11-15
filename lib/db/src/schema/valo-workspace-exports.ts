import {pgTable,uuid,text,integer,timestamp,uniqueIndex,index,check} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import {valoWorkspaces} from "./valo-workspaces";

/** Request identity survives process/transport retries. Each queueId fences one
 * worker generation; private object reservations live in the shared registry. */
export const valoWorkspaceExports=pgTable("valo_workspace_exports",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  requestedBy:text("requested_by").notNull(),idempotencyKey:uuid("idempotency_key").notNull(),
  schemaVersion:integer("schema_version").notNull().default(2),
  status:text("status").notNull().default("queued").$type<"queued"|"running"|"retrying"|"ready"|"failed"|"cancelled"|"expired">(),
  version:integer("version").notNull().default(1),queueId:uuid("queue_id").notNull(),
  attempts:integer("attempts").notNull().default(0),retryCycles:integer("retry_cycles").notNull().default(0),
  leaseRecoveries:integer("lease_recoveries").notNull().default(0),
  leaseExpiresAt:timestamp("lease_expires_at",{withTimezone:true}),
  nextAttemptAt:timestamp("next_attempt_at",{withTimezone:true}).notNull().defaultNow(),
  rowsProcessed:integer("rows_processed").notNull().default(0),bytesPrepared:integer("bytes_prepared").notNull().default(0),
  errorCode:text("error_code"),expiresAt:timestamp("expires_at",{withTimezone:true}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex("valo_workspace_export_scope").on(t.id,t.workspaceId),
  uniqueIndex("valo_workspace_export_request").on(t.workspaceId,t.requestedBy,t.idempotencyKey),
  uniqueIndex("valo_workspace_export_active").on(t.workspaceId,t.requestedBy)
    .where(sql`${t.status} IN ('queued','running','retrying')`),
  index("valo_workspace_export_dispatch").on(t.status,t.nextAttemptAt),
  check("valo_workspace_export_status",sql`${t.status} IN ('queued','running','retrying','ready','failed','cancelled','expired')`),
  check("valo_workspace_export_counts",sql`${t.version}>0 AND ${t.schemaVersion}=2 AND ${t.attempts}>=0 AND ${t.attempts}<=3
    AND ${t.retryCycles}>=0 AND ${t.retryCycles}<=2 AND ${t.leaseRecoveries}>=0 AND ${t.rowsProcessed}>=0 AND ${t.bytesPrepared}>=0`),
]);
