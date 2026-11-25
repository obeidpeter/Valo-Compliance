import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { valoWorkspaces } from "./valo-workspaces";

/**
 * A notice to a workspace that saved a result listing a requirements-check rule's version, or made a
 * task from it, that the version was replaced or withdrawn (docs/architecture/rule-changes.md,
 * slice 2). The database writes it, with the change's reason, in the transaction that makes the
 * change, on either route; the workspace may only mark it read. One per workspace, version and kind
 * of change.
 */
export const valoRuleNotices = pgTable(
  "valo_rule_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    ruleId: text("rule_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    replacementVersion: integer("replacement_version"),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    results: integer("results").notNull(),
    tasks: integer("tasks").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("valo_rule_notice_once").on(t.workspaceId, t.ruleId, t.version, t.kind),
    index("valo_rule_notice_workspace").on(t.workspaceId, t.createdAt),
    check(
      "valo_rule_notice_shape",
      sql`${t.kind} IN ('replaced', 'withdrawn') AND ((${t.kind} = 'replaced') = (${t.replacementVersion} IS NOT NULL)) AND ${t.results} >= 0 AND ${t.tasks} >= 0 AND (${t.results} > 0 OR ${t.tasks} > 0)`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export type ValoRuleNotice = typeof valoRuleNotices.$inferSelect;
