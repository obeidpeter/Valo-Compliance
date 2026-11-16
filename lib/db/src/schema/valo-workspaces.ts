import { pgTable, text, uuid, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const valoWorkspaces = pgTable(
  "valo_workspaces",
  {
    id: uuid("id").primaryKey(),
    ownerIdentityId: text("owner_identity_id").notNull(),
    profileRevision: integer("profile_revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("valo_workspace_owner_unique").on(t.ownerIdentityId)],
);
export const insertValoWorkspaceSchema = createInsertSchema(valoWorkspaces);
export type ValoWorkspace = typeof valoWorkspaces.$inferSelect;
