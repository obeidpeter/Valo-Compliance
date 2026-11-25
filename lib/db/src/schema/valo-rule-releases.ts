import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
/** Global editorial registry, not customer-owned data. No customer write endpoint. */
export const valoRuleReleases = pgTable(
  "valo_rule_releases",
  {
    id: uuid("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    rule: jsonb("rule").notNull().$type<unknown>(),
    publicationBundle: jsonb("publication_bundle").notNull().$type<unknown>(),
    manifestHash: text("manifest_hash").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("valo_rule_release_version_unique").on(t.ruleId, t.version)],
);
export const insertValoRuleReleaseSchema = createInsertSchema(valoRuleReleases);
export type ValoRuleRelease = typeof valoRuleReleases.$inferSelect;

/**
 * The development owner's sign-off of one rule version (decision 0020), recorded in the transaction
 * that releases it. Never updated or deleted. The release's own trigger refuses an owner-signed rule
 * without a sign-off of its exact manifest made in the same transaction, by the designated owner, on a
 * source check under a day old.
 */
export const valoRuleOwnerSignoffs = pgTable(
  "valo_rule_owner_signoffs",
  {
    id: uuid("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    version: integer("version").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    ownerIdentityId: text("owner_identity_id").notNull(),
    /** The oldest of the sources' current captures the sign-off was made on. */
    sourceCheckedAt: timestamp("source_checked_at", { withTimezone: true }).notNull(),
    /** EDP-005's enhanced checks the owner confirmed for this exact version. */
    confirmedChecks: jsonb("confirmed_checks").notNull().$type<string[]>(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_rule_owner_signoff_version").on(t.ruleId, t.version),
    check("valo_rule_owner_signoff_manifest", sql`${t.manifestHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
export type ValoRuleOwnerSignoff = typeof valoRuleOwnerSignoffs.$inferSelect;

/**
 * Why a released rule version left the requirements check, who made the change, and whom it affected
 * (docs/architecture/rule-changes.md, slice 1). A version moves from published to superseded or
 * withdrawn only when its record was written in the same transaction; the database counts, as the
 * record is written, the workspaces, saved results and tasks made under that version. Never changed or
 * removed.
 */
export const valoRuleChanges = pgTable(
  "valo_rule_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: text("rule_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    replacementVersion: integer("replacement_version"),
    reason: text("reason").notNull(),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    workspaces: integer("workspaces").notNull().default(0),
    results: integer("results").notNull().default(0),
    tasks: integer("tasks").notNull().default(0),
  },
  (t) => [
    index("valo_rule_change_version").on(t.ruleId, t.version),
    check(
      "valo_rule_change_shape",
      sql`${t.kind} IN ('replaced', 'withdrawn') AND ((${t.kind} = 'replaced') = (${t.replacementVersion} IS NOT NULL)) AND (${t.replacementVersion} IS NULL OR ${t.replacementVersion} > ${t.version}) AND char_length(${t.reason}) BETWEEN 20 AND 1000 AND ${t.workspaces} >= 0 AND ${t.results} >= 0 AND ${t.tasks} >= 0`,
    ),
  ],
);
export type ValoRuleChange = typeof valoRuleChanges.$inferSelect;
