import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";

export const valoEvents = pgTable(
  "valo_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityId: uuid("entity_id").notNull(),
    revision: integer("revision"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_events_workspace_entity_action_idx").on(t.workspaceId, t.entityId, t.action, t.createdAt),
    index("valo_events_workspace_created_idx").on(t.workspaceId, t.createdAt),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoEventSchema = createInsertSchema(valoEvents);
export type ValoEvent = typeof valoEvents.$inferSelect;
