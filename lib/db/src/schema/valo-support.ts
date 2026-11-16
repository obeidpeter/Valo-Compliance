import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";

export const valoSupportTickets = pgTable(
  "valo_support_tickets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    category: text("category").notNull(),
    scope: text("scope").notNull(),
    contactEmail: text("contact_email").notNull(),
    sharingConsent: boolean("sharing_consent").notNull(),
    consentVersion: text("consent_version").notNull(),
    dispatchStatus: text("dispatch_status", { enum: ["awaiting_staff"] })
      .notNull()
      .default("awaiting_staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("valo_support_ticket_workspace").on(t.id, t.workspaceId)],
);
export const insertValoTicketSchema = createInsertSchema(valoSupportTickets);
export type ValoTicket = typeof valoSupportTickets.$inferSelect;
