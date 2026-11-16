import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
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
    uniqueIndex("valo_staff_role_change_request").on(t.actorId, t.requestKey),
    index("valo_staff_role_change_time").on(t.createdAt, t.id),
  ],
);
