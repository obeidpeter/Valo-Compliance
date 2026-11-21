import { pgTable, uuid, text, jsonb, timestamp, unique, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { valoStaffAssignments } from "./valo-customer-access";
export const valoStaffRoleChanges = pgTable(
  "valo_staff_role_changes",
  {
    id: uuid("id").primaryKey(),
    requestKey: uuid("request_key").notNull(),
    inputHash: text("input_hash").notNull(),
    actorId: text("actor_id").notNull(),
    actorAssignmentId: uuid("actor_assignment_id")
      .notNull()
      .references(() => valoStaffAssignments.id),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => valoStaffAssignments.id),
    targetIdentityId: text("target_identity_id").notNull(),
    action: text("action", { enum: ["grant", "revoke"] }).notNull(),
    role: text("role").notNull(),
    reason: text("reason").notNull(),
    incidentReference: text("incident_reference"),
    before: jsonb("before_state").$type<Record<string, unknown>>(),
    after: jsonb("after_state").$type<Record<string, unknown>>().notNull(),
    targetVerifiedAt: timestamp("target_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("valo_staff_role_change_request").on(t.actorId, t.requestKey),
    index("valo_staff_role_change_time").on(t.createdAt, t.id),
    check("valo_staff_role_changes_action_check", sql`${t.action} IN ('grant', 'revoke')`),
    check("valo_staff_role_changes_input_hash_check", sql`length(${t.inputHash}) = 64`),
    check("valo_staff_role_changes_reason_check", sql`length(${t.reason}) BETWEEN 20 AND 1000`),
  ],
);
