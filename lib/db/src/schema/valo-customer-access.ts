import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
/** Public contact intake is deliberately not linked to an assumed customer. */
export const valoAccessSupport = pgTable(
  "valo_access_support",
  {
    id: uuid("id").primaryKey(),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    payloadHash: text("payload_hash").notNull(),
    contactEmail: text("contact_email").notNull(),
    topic: text("topic").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("awaiting_staff"),
    noticeVersion: text("notice_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_access_support_queue").on(t.status, t.createdAt),
    check("valo_access_support_contact_email_check", sql`length(${t.contactEmail}) <= 254`),
    check("valo_access_support_message_check", sql`length(${t.message}) BETWEEN 20 AND 2000`),
    check("valo_access_support_payload_hash_check", sql`length(${t.payloadHash}) = 64`),
    check("valo_access_support_status_check", sql`${t.status} = 'awaiting_staff'`),
    check(
      "valo_access_support_topic_check",
      sql`${t.topic} IN ('account_access', 'general', 'content_issue')`,
    ),
  ],
);
/** Managed only by an authorised permanent system operator; no self-enrolment. */
export const valoStaffAssignments = pgTable(
  "valo_staff_assignments",
  {
    id: uuid("id").primaryKey(),
    identityId: text("identity_id").notNull(),
    role: text("role", {
      enum: ["content", "support", "finance", "system", "privacy", "reviewer"],
    }).notNull(),
    active: boolean("active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    grantMode: text("grant_mode", { enum: ["permanent", "break_glass"] })
      .notNull()
      .default("permanent"),
    version: integer("version").notNull().default(1),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedBy: text("granted_by").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_staff_identity_role").on(t.identityId, t.role),
    check("valo_staff_assignments_grant_mode_check", sql`${t.grantMode} IN ('permanent', 'break_glass')`),
    check("valo_staff_assignments_granted_by_check", sql`length(${t.grantedBy}) > 0`),
    check("valo_staff_assignments_reason_check", sql`length(${t.reason}) > 0`),
    check(
      "valo_staff_assignments_role_check",
      sql`${t.role} IN ('content', 'support', 'finance', 'system', 'privacy', 'reviewer')`,
    ),
    check("valo_staff_assignments_version_check", sql`${t.version} > 0`),
    check(
      "valo_staff_expiry_shape",
      sql`(${t.grantMode} = 'permanent' AND ${t.expiresAt} IS NULL) OR (${t.grantMode} = 'break_glass' AND ${t.expiresAt} IS NOT NULL AND ${t.expiresAt} >= ${t.grantedAt} + interval '5 minutes' AND ${t.expiresAt} <= ${t.grantedAt} + interval '60 minutes')`,
    ),
  ],
);
export const valoStaffAccessAudit = pgTable("valo_staff_access_audit", {
  id: uuid("id").primaryKey(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => valoStaffAssignments.id),
  actorId: text("actor_id").notNull(),
  area: text("area").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
