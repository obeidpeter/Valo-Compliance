import {
  pgTable,
  text,
  jsonb,
  integer,
  timestamp,
  bigserial,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const valoInferenceBudgets = pgTable(
  "valo_inference_budgets",
  {
    id: text("id").primaryKey(),
    policyHash: text("policy_hash").notNull(),
    state: jsonb("state").notNull(),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("valo_inference_budgets_state_check", sql`jsonb_typeof(${t.state})='object'`),
    check("valo_inference_budgets_version_check", sql`${t.version}>=0`),
  ],
);
export const valoInferenceBudgetEvents = pgTable(
  "valo_inference_budget_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    budgetId: text("budget_id").notNull(),
    version: integer("version").notNull(),
    action: text("action").notNull(),
    beforeHash: text("before_hash").notNull(),
    afterHash: text("after_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("valo_inference_event_version").on(t.budgetId, t.version),
    foreignKey({
      columns: [t.budgetId],
      foreignColumns: [valoInferenceBudgets.id],
      name: "valo_inference_budget_events_budget_id_fkey",
    }),
  ],
);
