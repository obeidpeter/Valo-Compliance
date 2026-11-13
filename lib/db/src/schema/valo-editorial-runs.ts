import { pgTable,uuid,text,timestamp,jsonb,integer,index,uniqueIndex,check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { valoSourceSnapshots } from "./valo-source-snapshots";
export const valoEditorialRuns=pgTable("valo_editorial_runs",{
  id:uuid("id").primaryKey(),pipelineId:uuid("pipeline_id").notNull(),
  sourceSnapshotId:uuid("source_snapshot_id").notNull().references(()=>valoSourceSnapshots.id),
  role:text("role").notNull(),status:text("status").notNull(),
  model:text("model").notNull(),promptVersion:text("prompt_version").notNull(),
  inputHash:text("input_hash"),candidateHash:text("candidate_hash"),
  sourceHash:text("source_hash").notNull(),outputHash:text("output_hash"),
  objectKey:text("object_key"),providerResponseId:text("provider_response_id"),
  providerRequestId:text("provider_request_id"),latencyMs:integer("latency_ms"),
  inputTokens:integer("input_tokens"),outputTokens:integer("output_tokens"),
  failureCode:text("failure_code"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull(),
  completedAt:timestamp("completed_at",{withTimezone:true}),
  metadata:jsonb("metadata").$type<Record<string,unknown>>().notNull(),
},t=>[
  uniqueIndex("valo_editorial_pipeline_role").on(t.pipelineId,t.role),
  index("valo_editorial_created").on(t.createdAt),
  check("valo_editorial_role_check",sql`${t.role} in ('draft','factual','challenge')`),
  check("valo_editorial_status_check",sql`${t.status} in ('reserved','running','succeeded','failed','dependency_held')`),
]);
export const insertValoEditorialRunSchema=createInsertSchema(valoEditorialRuns);
export type ValoEditorialRun=typeof valoEditorialRuns.$inferSelect;
