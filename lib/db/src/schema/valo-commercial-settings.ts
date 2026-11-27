import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * ADM-006 (docs/architecture/commercial-settings.md, slice 3): the owner's commercial settings, versioned
 * as prices are. A setting's value never changes in place: a new value is a new row with its own
 * effective dates, and the open one closes when the new one starts, once. A row is never removed. The
 * keys are a closed list in the code (`modules/commercial-settings`); a key with no row in effect reads
 * as its default, which is the constant the code held before.
 */
export const valoCommercialSettings = pgTable(
  "valo_commercial_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    value: jsonb("value").notNull().$type<number | boolean>(),
    approvalReference: text("approval_reference").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one value of a setting has no end: the one in effect, or the one scheduled last.
    uniqueIndex("valo_commercial_settings_open_unique")
      .on(t.key)
      .where(sql`${t.effectiveTo} IS NULL`),
    // The drafting assistant's two daily allowances are whole numbers, none below nought; the code
    // refuses a value far above today's as a likely typing error. The access rule is yes or no.
    check(
      "valo_commercial_settings_value_check",
      sql`CASE WHEN ${t.key} IN ('drafting_workspace_daily', 'drafting_daily_in_all') AND jsonb_typeof(${t.value}) = 'number' THEN (${t.value})::numeric >= 0 AND (${t.value})::numeric = trunc((${t.value})::numeric) WHEN ${t.key} = 'purchase_carries_to_later_editions' THEN jsonb_typeof(${t.value}) = 'boolean' ELSE false END`,
    ),
    check("valo_commercial_settings_approval_reference_check", sql`length(${t.approvalReference}) > 0`),
    check(
      "valo_commercial_settings_check",
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

/**
 * ADM-006: every insert and close of a commercial setting, written by the triggers on
 * valo_commercial_settings (migration commercial_setting_guards). Rows here are never updated or
 * removed.
 */
export const valoCommercialSettingChanges = pgTable(
  "valo_commercial_setting_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settingId: uuid("setting_id").notNull(),
    action: text("action").notNull(),
    setting: jsonb("setting").notNull().$type<Record<string, unknown>>(),
    changedBy: text("changed_by")
      .notNull()
      .default(sql`current_user`),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_commercial_setting_changes_setting_idx").on(t.settingId, t.changedAt),
    check("valo_commercial_setting_changes_action_check", sql`${t.action} IN ('created', 'closed')`),
  ],
);
