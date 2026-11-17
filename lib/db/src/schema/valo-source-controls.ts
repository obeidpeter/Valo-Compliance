import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  date,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { valoSourceSnapshots } from "./valo-source-snapshots";
import { valoWorkspaces } from "./valo-workspaces";
import { valoStaffAssignments } from "./valo-customer-access";
export const valoSourceWatches = pgTable(
  "valo_source_watches",
  {
    sourceId: text("source_id").primaryKey(),
    url: text("url").notNull(),
    risk: text("risk").notNull(),
    lastSnapshotId: uuid("last_snapshot_id").references(() => valoSourceSnapshots.id),
    lastRawHash: text("last_raw_hash"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("valo_source_watches_risk_check", sql`${t.risk} IN ('high', 'standard')`)],
);
export const valoSourceCheckJobs = pgTable(
  "valo_source_check_jobs",
  {
    id: uuid("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => valoSourceWatches.sourceId),
    day: date("day").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    snapshotId: uuid("snapshot_id").references(() => valoSourceSnapshots.id),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_source_check_jobs_source_id_day_key").on(t.sourceId, t.day),
    index("valo_source_check_due").on(t.status, t.leaseUntil),
    check("valo_source_check_jobs_attempts_check", sql`${t.attempts} BETWEEN 0 AND 3`),
    check("valo_source_check_jobs_status_check", sql`${t.status} IN ('pending', 'running', 'complete')`),
  ],
);
export const valoSourceReleaseBindings = pgTable(
  "valo_source_release_bindings",
  {
    targetKind: text("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => valoSourceWatches.sourceId),
    bundleSourceId: text("bundle_source_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => valoSourceSnapshots.id),
    rawHash: text("raw_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.targetKind, t.targetId, t.bundleSourceId] }),
    check("valo_source_release_bindings_target_kind_check", sql`${t.targetKind} IN ('content', 'rule')`),
  ],
);
export const valoSourceImpacts = pgTable(
  "valo_source_impacts",
  {
    id: uuid("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    targetKind: text("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    targetKey: text("target_key").notNull(),
    targetVersion: integer("target_version").notNull(),
    sourceId: text("source_id").references(() => valoSourceWatches.sourceId),
    oldSnapshotId: uuid("old_snapshot_id"),
    newSnapshotId: uuid("new_snapshot_id"),
    reason: text("reason").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    phase: text("phase").notNull().default("tasks"),
    cursorId: uuid("cursor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("valo_source_impact_queue").on(t.phase, t.createdAt),
    index("valo_source_impact_target").on(t.targetKind, t.targetId),
    check("valo_source_impacts_action_check", sql`${t.action} IN ('hold', 'withdraw')`),
    check(
      "valo_source_impacts_phase_check",
      sql`${t.phase} IN ('derived', 'tasks', 'assessments', 'documents', 'purchases', 'complete')`,
    ),
    check("valo_source_impacts_target_kind_check", sql`${t.targetKind} IN ('content', 'rule')`),
  ],
);
export const valoSourceReviewWork = pgTable(
  "valo_source_review_work",
  {
    id: uuid("id").primaryKey(),
    impactId: uuid("impact_id")
      .notNull()
      .unique()
      .references(() => valoSourceImpacts.id),
    status: text("status").notNull().default("awaiting_authorized_review"),
    replacementKind: text("replacement_kind"),
    replacementId: uuid("replacement_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "valo_source_review_work_status_check",
      sql`${t.status} IN ('awaiting_authorized_review', 'superseded_by_eligible_version')`,
    ),
  ],
);
export const valoSourceDependencyJobs = pgTable(
  "valo_source_dependency_jobs",
  {
    id: uuid("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => valoSourceWatches.sourceId),
    dedupeKey: text("dedupe_key").notNull().unique(),
    reason: text("reason").notNull(),
    newSnapshotId: uuid("new_snapshot_id"),
    observedHash: text("observed_hash"),
    cursorKind: text("cursor_kind"),
    cursorId: uuid("cursor_id"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("valo_source_dependency_pending").on(t.status, t.createdAt),
    check("valo_source_dependency_jobs_status_check", sql`${t.status} IN ('pending', 'complete')`),
  ],
);
export const valoCorrectionNotices = pgTable(
  "valo_correction_notices",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    impactId: uuid("impact_id")
      .notNull()
      .references(() => valoSourceImpacts.id),
    entityKind: text("entity_kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_correction_notices_workspace_id_impact_id_entity_kind_entity_id_key").on(
      t.workspaceId,
      t.impactId,
      t.entityKind,
      t.entityId,
    ),
    index("valo_correction_notice_workspace").on(t.workspaceId, t.createdAt),
  ],
);
export const valoSafetyControlAudit = pgTable("valo_safety_control_audit", {
  id: uuid("id").primaryKey(),
  requestKey: uuid("request_key").notNull().unique(),
  actorId: text("actor_id").notNull(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => valoStaffAssignments.id),
  area: text("area").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  reason: text("reason").notNull(),
  previous: jsonb("previous").notNull(),
  current: jsonb("current").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
