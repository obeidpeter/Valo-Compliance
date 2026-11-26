import { boolean, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { valoWorkspaces } from "./valo-workspaces";

/**
 * Each change to a workspace's optional choices: marketing messages, set in the business profile, and
 * task reminders (PRO-002; docs/architecture/processing-inventory.md, slice 4). Who made it, when, what
 * was chosen and the version of the privacy notice in force. Customer requests may only add a row and
 * read their own; nothing changes one.
 */
export const valoConsentChanges = pgTable(
  "valo_consent_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    consent: text("consent").notNull(),
    choice: boolean("choice").notNull(),
    noticeVersion: text("notice_version").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_consent_change_workspace").on(t.workspaceId, t.consent, t.createdAt),
    check(
      "valo_consent_change_shape",
      sql`${t.consent} IN ('marketing', 'reminders') AND ${t.noticeVersion} ~ '^[0-9a-f]{64}$'`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export type ValoConsentChange = typeof valoConsentChanges.$inferSelect;
