import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";

export const valoEvents = pgTable("valo_events", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => valoWorkspaces.id),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityId: uuid("entity_id").notNull(),
  revision: integer("revision"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertValoEventSchema = createInsertSchema(valoEvents);
export type ValoEvent = typeof valoEvents.$inferSelect;
