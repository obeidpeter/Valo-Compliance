import { pgTable, text, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";

export const valoMemberships = pgTable("valo_memberships", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => valoWorkspaces.id),
  identityId: text("identity_id").notNull(),
  role: text("role", { enum: ["owner", "member"] }).notNull(),
  active: text("active", { enum: ["yes", "no"] }).notNull().default("yes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("valo_membership_identity_unique").on(t.identityId)]);
export const insertValoMembershipSchema = createInsertSchema(valoMemberships);
export type ValoMembership = typeof valoMemberships.$inferSelect;
