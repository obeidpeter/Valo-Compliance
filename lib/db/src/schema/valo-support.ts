import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  integer,
  index,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { supportCaseRowPolicy, workspaceRowPolicy } from "./valo-workspace-scope";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
import { valoAccessSupport } from "./valo-customer-access";

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
  (t) => [
    uniqueIndex("valo_support_ticket_workspace").on(t.id, t.workspaceId),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoTicketSchema = createInsertSchema(valoSupportTickets);
export type ValoTicket = typeof valoSupportTickets.$inferSelect;

export const valoSupportCases = pgTable(
  "valo_support_cases",
  {
    id: uuid("id").primaryKey(),
    sourceKind: text("source_kind", { enum: ["workspace", "access"] }).notNull(),
    ticketId: uuid("ticket_id")
      .references(() => valoSupportTickets.id, { onDelete: "cascade" })
      .unique(),
    accessId: uuid("access_id")
      .references(() => valoAccessSupport.id, { onDelete: "cascade" })
      .unique(),
    workspaceId: uuid("workspace_id").references(() => valoWorkspaces.id),
    status: text("status", { enum: ["open", "in_progress", "awaiting_customer", "resolved"] })
      .notNull()
      .default("open"),
    assignedTo: text("assigned_to"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_support_case_queue").on(t.status, t.updatedAt),
    foreignKey({
      name: "valo_support_case_workspace",
      columns: [t.ticketId, t.workspaceId],
      foreignColumns: [valoSupportTickets.id, valoSupportTickets.workspaceId],
    }).onDelete("cascade"),
    check("valo_support_cases_source_kind_check", sql`${t.sourceKind} IN ('workspace','access')`),
    check(
      "valo_support_cases_status_check",
      sql`${t.status} IN ('open','in_progress','awaiting_customer','resolved')`,
    ),
    check("valo_support_cases_version_check", sql`${t.version} > 0`),
    check(
      "valo_support_case_source",
      sql`(${t.sourceKind}='workspace' AND ${t.ticketId} IS NOT NULL AND ${t.accessId} IS NULL AND ${t.workspaceId} IS NOT NULL)
    OR (${t.sourceKind}='access' AND ${t.accessId} IS NOT NULL AND ${t.ticketId} IS NULL AND ${t.workspaceId} IS NULL)`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoSupportMessages = pgTable(
  "valo_support_messages",
  {
    id: uuid("id").primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => valoSupportCases.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => valoWorkspaces.id),
    authorId: text("author_id").notNull(),
    authorKind: text("author_kind", { enum: ["customer", "staff"] }).notNull(),
    visibility: text("visibility", { enum: ["customer", "internal"] }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_support_message_case").on(t.caseId, t.createdAt),
    check("valo_support_message_body", sql`char_length(${t.body}) BETWEEN 8 AND 4000`),
    check("valo_support_messages_author_kind_check", sql`${t.authorKind} IN ('customer','staff')`),
    check("valo_support_messages_visibility_check", sql`${t.visibility} IN ('customer','internal')`),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoSupportActions = pgTable(
  "valo_support_actions",
  {
    id: uuid("id").primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => valoSupportCases.id, { onDelete: "cascade" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    actorId: text("actor_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_support_action_request").on(t.caseId, t.actorId, t.idempotencyKey),
    supportCaseRowPolicy(t.caseId),
  ],
);
export const valoSupportEvents = pgTable(
  "valo_support_events",
  {
    id: uuid("id").primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => valoSupportCases.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [supportCaseRowPolicy(t.caseId)],
);
export const valoSupportEscalations = pgTable(
  "valo_support_escalations",
  {
    id: uuid("id").primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => valoSupportCases.id, { onDelete: "cascade" }),
    targetKind: text("target_kind", { enum: ["content", "rule"] }).notNull(),
    targetId: uuid("target_id").notNull(),
    targetHash: text("target_hash").notNull(),
    targetVersion: integer("target_version").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["queued", "acknowledged", "resolved"] })
      .notNull()
      .default("queued"),
    sourceImpactId: uuid("source_impact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_support_escalation_queue").on(t.status, t.createdAt),
    check("valo_support_escalations_target_kind_check", sql`${t.targetKind} IN ('content','rule')`),
    check("valo_support_escalations_target_version_check", sql`${t.targetVersion} > 0`),
    check("valo_support_escalations_reason_check", sql`char_length(${t.reason}) BETWEEN 8 AND 4000`),
    check("valo_support_escalations_status_check", sql`${t.status} IN ('queued','acknowledged','resolved')`),
    supportCaseRowPolicy(t.caseId),
  ],
);
