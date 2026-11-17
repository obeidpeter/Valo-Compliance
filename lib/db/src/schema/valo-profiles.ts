import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";

export const valoProfileVersions = pgTable(
  "valo_profile_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    revision: integer("revision").notNull(),
    profile: jsonb("profile").notNull().$type<Record<string, unknown>>(),
    profileHash: text("profile_hash").notNull(),
    noticeVersion: text("notice_version").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_profile_revision_unique").on(t.workspaceId, t.revision),
    uniqueIndex("valo_profile_workspace_id_unique").on(t.workspaceId, t.id),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoProfileSchema = createInsertSchema(valoProfileVersions);
export type ValoProfileVersion = typeof valoProfileVersions.$inferSelect;
