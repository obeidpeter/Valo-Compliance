import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  date,
  uniqueIndex,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
import { valoProfileVersions } from "./valo-profiles";

export const valoAssessments = pgTable(
  "valo_assessments",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    profileVersionId: uuid("profile_version_id"),
    profileRevision: integer("profile_revision"),
    facts: jsonb("facts").notNull().$type<unknown>(),
    factsHash: text("facts_hash").notNull(),
    result: jsonb("result").notNull().$type<unknown>(),
    resultHash: text("result_hash").notNull(),
    rulesetVersion: text("ruleset_version").notNull(),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    consentVersion: text("consent_version").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_assessment_workspace_id_unique").on(t.workspaceId, t.id),
    index("valo_assessment_history_idx").on(t.workspaceId, t.createdAt),
    foreignKey({
      name: "valo_assessment_profile_tenant_fk",
      columns: [t.workspaceId, t.profileVersionId],
      foreignColumns: [valoProfileVersions.workspaceId, valoProfileVersions.id],
    }),
  ],
);
export const insertValoAssessmentSchema = createInsertSchema(valoAssessments);
export type ValoAssessment = typeof valoAssessments.$inferSelect;
