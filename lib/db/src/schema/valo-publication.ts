import { pgTable, text, uuid, jsonb, integer, timestamp, uniqueIndex, bigserial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const valoPublicationPolicies = pgTable("valo_publication_policies", {
  id:text("id").primaryKey(), hash:text("hash").notNull(), policy:jsonb("policy").notNull(),
  authority:jsonb("authority").notNull(), createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const valoContentVersions = pgTable("valo_content_versions", {
  id:uuid("id").primaryKey(), templateId:text("template_id").notNull(), version:integer("version").notNull(),
  slug:text("slug").notNull(), policyId:text("policy_id").notNull().references(()=>valoPublicationPolicies.id),
  candidateHash:text("candidate_hash").notNull(), bundle:jsonb("bundle").notNull(),
  attestations:jsonb("attestations").notNull(), status:text("status").notNull().default("candidate"),
  reviewBy:timestamp("review_by",{withTimezone:true}).notNull(),
  publishedAt:timestamp("published_at",{withTimezone:true}), withdrawnReason:text("withdrawn_reason"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
}, t=>[uniqueIndex("valo_content_template_version_unique").on(t.templateId,t.version)]);
export const valoPublicationAudit = pgTable("valo_publication_audit", {
  id:uuid("id").primaryKey(), versionId:uuid("version_id").notNull().references(()=>valoContentVersions.id),
  action:text("action").notNull(), actor:text("actor").notNull(), reason:text("reason").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const insertValoContentVersionSchema=createInsertSchema(valoContentVersions);
export const valoPublicationAiAttempts=pgTable("valo_publication_ai_attempts",{
  id:bigserial("id",{mode:"number"}).primaryKey(),candidateHash:text("candidate_hash").notNull(),
  role:text("role").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  requestHash:text("request_hash"),requestMeter:jsonb("request_meter"),
  outcome:text("outcome").notNull().default("legacy_unmetered"),
  providerResponseId:text("provider_response_id"),inputTokens:integer("input_tokens"),
  outputTokens:integer("output_tokens"),errorCode:text("error_code"),
  completedAt:timestamp("completed_at",{withTimezone:true}),
});
