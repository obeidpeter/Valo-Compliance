import {
  pgTable,
  text,
  uuid,
  jsonb,
  integer,
  timestamp,
  uniqueIndex,
  index,
  bigserial,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
export const valoPublicationPolicies = pgTable("valo_publication_policies", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  policy: jsonb("policy").notNull(),
  authority: jsonb("authority").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const valoContentVersions = pgTable(
  "valo_content_versions",
  {
    id: uuid("id").primaryKey(),
    templateId: text("template_id").notNull(),
    version: integer("version").notNull(),
    slug: text("slug").notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => valoPublicationPolicies.id),
    candidateHash: text("candidate_hash").notNull(),
    bundle: jsonb("bundle").notNull(),
    attestations: jsonb("attestations").notNull(),
    status: text("status").notNull().default("candidate"),
    reviewBy: timestamp("review_by", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    withdrawnReason: text("withdrawn_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_content_template_version_unique").on(t.templateId, t.version),
    index("valo_content_discovery_idx").on(t.status, t.reviewBy, t.slug),
    check(
      "valo_content_versions_status_check",
      sql`${t.status} IN ('candidate', 'held', 'published', 'withdrawn')`,
    ),
    check("valo_content_versions_version_check", sql`${t.version} > 0`),
  ],
);
export const valoPublicationAudit = pgTable("valo_publication_audit", {
  id: uuid("id").primaryKey(),
  versionId: uuid("version_id")
    .notNull()
    .references(() => valoContentVersions.id),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertValoContentVersionSchema = createInsertSchema(valoContentVersions);
/**
 * A template candidate kept as a private artifact until its two reviews are checked (decision
 * 0014). The artifact is the candidate; this row only lets staff find it. It names the version ID
 * and number the candidate will be saved under, and the drafter role only adds rows.
 */
export const valoPreparedCandidates = pgTable(
  "valo_prepared_candidates",
  {
    artifactId: uuid("artifact_id").primaryKey(),
    artifactHash: text("artifact_hash").notNull(),
    versionId: uuid("version_id").notNull(),
    templateId: text("template_id").notNull(),
    version: integer("version").notNull(),
    candidateHash: text("candidate_hash").notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull(),
    reviewBy: timestamp("review_by", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_prepared_candidates_version_id_unique").on(t.versionId),
    index("valo_prepared_candidates_template_idx").on(t.templateId, t.version),
    check("valo_prepared_candidates_artifact_hash_check", sql`${t.artifactHash} ~ '^[a-f0-9]{64}$'`),
    check("valo_prepared_candidates_candidate_hash_check", sql`${t.candidateHash} ~ '^[a-f0-9]{64}$'`),
    check("valo_prepared_candidates_version_check", sql`${t.version} > 0`),
  ],
);
export const valoPublicationAiAttempts = pgTable(
  "valo_publication_ai_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    candidateHash: text("candidate_hash").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    requestHash: text("request_hash"),
    requestMeter: jsonb("request_meter"),
    outcome: text("outcome").notNull().default("legacy_unmetered"),
    providerResponseId: text("provider_response_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: text("error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("valo_publication_attempt_request_idx").on(t.candidateHash, t.role, t.requestHash),
    check("valo_publication_ai_attempts_input_tokens_check", sql`${t.inputTokens} >= 0`),
    check("valo_publication_ai_attempts_output_tokens_check", sql`${t.outputTokens} >= 0`),
    check("valo_publication_ai_attempts_role_check", sql`${t.role} IN ('draft', 'factual', 'challenge')`),
  ],
);
