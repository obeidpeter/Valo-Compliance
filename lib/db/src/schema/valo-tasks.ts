import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
import { valoAssessments } from "./valo-assessments";

export const valoTasks = pgTable(
  "valo_tasks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    title: text("title").notNull(),
    notes: text("notes").notNull(),
    state: text("state").notNull().default("not_started"),
    revision: integer("revision").notNull().default(1),
    dueDate: date("due_date", { mode: "string" }),
    dateConfirmed: boolean("date_confirmed").notNull().default(false),
    assessmentId: uuid("assessment_id"),
    ruleId: text("rule_id"),
    ruleVersion: integer("rule_version"),
    needsReview: boolean("needs_review").notNull().default(false),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("valo_task_workspace_id_unique").on(t.workspaceId, t.id),
    index("valo_task_workspace_state_idx").on(t.workspaceId, t.state),
    foreignKey({
      name: "valo_task_assessment_tenant_fk",
      columns: [t.workspaceId, t.assessmentId],
      foreignColumns: [valoAssessments.workspaceId, valoAssessments.id],
    }),
  ],
);
export const insertValoTaskSchema = createInsertSchema(valoTasks);
export type ValoTask = typeof valoTasks.$inferSelect;
