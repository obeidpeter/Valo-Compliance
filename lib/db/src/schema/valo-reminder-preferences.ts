import { pgTable, uuid, boolean, jsonb, integer, text, timestamp } from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
export const valoReminderPreferences = pgTable(
  "valo_reminder_preferences",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => valoWorkspaces.id),
    enabled: boolean("enabled").notNull().default(false),
    offsets: jsonb("offsets").notNull().$type<number[]>(),
    revision: integer("revision").notNull(),
    consentVersion: text("consent_version").notNull(),
    actorId: text("actor_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [workspaceRowPolicy(t.workspaceId)],
);
export const insertValoReminderPreferencesSchema = createInsertSchema(valoReminderPreferences);
export type ValoReminderPreferences = typeof valoReminderPreferences.$inferSelect;
