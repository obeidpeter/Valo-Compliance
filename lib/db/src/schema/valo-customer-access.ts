import { pgTable,uuid,text,timestamp,boolean,integer,uniqueIndex,index } from "drizzle-orm/pg-core";
/** Public contact intake is deliberately not linked to an assumed customer. */
export const valoAccessSupport=pgTable("valo_access_support",{
  id:uuid("id").primaryKey(),idempotencyKey:uuid("idempotency_key").notNull().unique(),
  payloadHash:text("payload_hash").notNull(),contactEmail:text("contact_email").notNull(),
  topic:text("topic").notNull(),message:text("message").notNull(),
  status:text("status").notNull().default("awaiting_staff"),
  noticeVersion:text("notice_version").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("valo_access_support_queue").on(t.status,t.createdAt)]);
/** Managed only by an authorised permanent system operator; no self-enrolment. */
export const valoStaffAssignments=pgTable("valo_staff_assignments",{
  id:uuid("id").primaryKey(),identityId:text("identity_id").notNull(),
  role:text("role",{enum:["content","support","finance","system","privacy"]}).notNull(),
  active:boolean("active").notNull().default(true),
  expiresAt:timestamp("expires_at",{withTimezone:true}),
  grantMode:text("grant_mode",{enum:["permanent","break_glass"]}).notNull().default("permanent"),
  version:integer("version").notNull().default(1),grantedAt:timestamp("granted_at",{withTimezone:true}).notNull().defaultNow(),
  grantedBy:text("granted_by").notNull(),
  reason:text("reason").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_staff_identity_role").on(t.identityId,t.role)]);
export const valoStaffAccessAudit=pgTable("valo_staff_access_audit",{
  id:uuid("id").primaryKey(),assignmentId:uuid("assignment_id").notNull().references(()=>valoStaffAssignments.id),
  actorId:text("actor_id").notNull(),area:text("area").notNull(),reason:text("reason").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});

