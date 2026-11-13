import { pgTable,uuid,text,integer,jsonb,boolean,timestamp,uniqueIndex,index,foreignKey } from "drizzle-orm/pg-core";
import { valoWorkspaces } from "./valo-workspaces";
import { valoDocuments } from "./valo-documents";
export const valoAIDrafts=pgTable("valo_ai_drafts",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  actorId:text("actor_id").notNull(),idempotencyKey:uuid("idempotency_key").notNull(),
  inputHash:text("input_hash").notNull(),providerInputHash:text("provider_input_hash"),
  task:text("task").notNull(),status:text("status").notNull(),promptVersion:text("prompt_version").notNull(),
  budgetReserved:boolean("budget_reserved").notNull().default(false),
  preview:jsonb("preview").notNull().$type<unknown>(),plan:jsonb("plan").$type<unknown>(),
  providerRuns:jsonb("provider_runs").notNull().$type<Record<string,unknown>[]>().default([]),
  providerCalls:integer("provider_calls").notNull().default(0),failureCode:text("failure_code"),
  acceptedDocumentId:uuid("accepted_document_id"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex("valo_ai_idempotency_unique").on(t.workspaceId,t.idempotencyKey),
  uniqueIndex("valo_ai_workspace_id_unique").on(t.workspaceId,t.id),
  uniqueIndex("valo_ai_accepted_document_unique").on(t.acceptedDocumentId),
  index("valo_ai_budget_date_idx").on(t.budgetReserved,t.createdAt),
  index("valo_ai_workspace_date_idx").on(t.workspaceId,t.createdAt),
  foreignKey({columns:[t.acceptedDocumentId,t.workspaceId],foreignColumns:[valoDocuments.id,valoDocuments.workspaceId]}),
]);
export const valoSafetySwitches=pgTable("valo_safety_switches",{
  key:text("key").primaryKey(),enabled:boolean("enabled").notNull().default(false),
  reason:text("reason").notNull(),actorId:text("actor_id").notNull(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});
