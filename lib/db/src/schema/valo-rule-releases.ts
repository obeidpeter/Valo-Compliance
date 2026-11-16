import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
