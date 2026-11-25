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
  foreignKey,
} from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { sql } from "drizzle-orm";
import { valoSourceSnapshots } from "./valo-source-snapshots";
import { valoWorkspaces } from "./valo-workspaces";
import { valoStaffAssignments } from "./valo-customer-access";
import { valoContentVersions, valoPreparedCandidates } from "./valo-publication";
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
    // When the daily check stopped, because the source register retired the source
    // (docs/architecture/source-register.md, slice 2). Null while it is watched.
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
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
    // A row closes when a later release replaces its version, or when its version is withdrawn
    // (docs/architecture/source-register.md, slice 3).
    check(
      "valo_source_review_work_status_check",
      sql`${t.status} IN ('awaiting_authorized_review', 'superseded_by_eligible_version', 'withdrawn')`,
    ),
  ],
);
/**
 * What was checked on an open row of review work, as the person accountable for it recorded it
 * (docs/architecture/source-register.md, slice 3). A note is never changed or removed.
 */
export const valoSourceReviewNotes = pgTable(
  "valo_source_review_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => valoSourceReviewWork.id),
    note: text("note").notNull(),
    recordedBy: text("recorded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_source_review_notes_work").on(t.workId, t.createdAt),
    check("valo_source_review_notes_note", sql`length(${t.note}) BETWEEN 20 AND 1000`),
  ],
);
/**
 * A Content editor's request to prepare the next candidate of a held template or guide from its row of
 * review work, and what came of it (docs/architecture/source-register.md, slice 4). The worker runs one
 * request at a time, within a lease, at most three times. A request is never removed, and once
 * finished it never changes.
 *
 * - prepared: the candidate is kept, awaiting its two reviews (its row in valo_prepared_candidates);
 * - held: a template's candidate failed a check and was saved as a held version;
 * - not_ready: a guide's candidate was not ready, for the reasons given, and nothing was kept;
 * - failed: the preparation stopped, for the reason given, and nothing was kept;
 * - closed: the review work closed before the request ran.
 */
export const valoSourceReviewPreparations = pgTable(
  "valo_source_review_preparations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    candidateArtifactId: uuid("candidate_artifact_id"),
    heldVersionId: uuid("held_version_id"),
    candidateVersion: integer("candidate_version"),
    reasons: jsonb("reasons")
      .notNull()
      .default(sql`'[]'::jsonb`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    // Named here: the names Drizzle would give are longer than PostgreSQL keeps.
    foreignKey({
      name: "valo_source_review_preparations_work_fk",
      columns: [t.workId],
      foreignColumns: [valoSourceReviewWork.id],
    }),
    foreignKey({
      name: "valo_source_review_preparations_candidate_fk",
      columns: [t.candidateArtifactId],
      foreignColumns: [valoPreparedCandidates.artifactId],
    }),
    foreignKey({
      name: "valo_source_review_preparations_held_version_fk",
      columns: [t.heldVersionId],
      foreignColumns: [valoContentVersions.id],
    }),
    // One request at a time waits or runs for a row of review work.
    uniqueIndex("valo_source_review_preparations_open")
      .on(t.workId)
      .where(sql`${t.status} IN ('pending', 'running')`),
    index("valo_source_review_preparations_due").on(t.status, t.requestedAt),
    check(
      "valo_source_review_preparations_status",
      sql`${t.status} IN ('pending', 'running', 'prepared', 'held', 'not_ready', 'failed', 'closed')`,
    ),
    check("valo_source_review_preparations_attempts", sql`${t.attempts} BETWEEN 0 AND 3`),
    check(
      "valo_source_review_preparations_outcome",
      sql`jsonb_typeof(${t.reasons}) = 'array' AND length(${t.reasons}::text) <= 4000
        AND (${t.candidateVersion} IS NULL OR ${t.candidateVersion} > 0) AND CASE
        WHEN ${t.status} IN ('pending', 'running') THEN ${t.completedAt} IS NULL
          AND ${t.candidateArtifactId} IS NULL AND ${t.heldVersionId} IS NULL AND ${t.candidateVersion} IS NULL
          AND ${t.reasons} = '[]'::jsonb
        WHEN ${t.status} = 'prepared' THEN ${t.completedAt} IS NOT NULL
          AND ${t.candidateArtifactId} IS NOT NULL AND ${t.heldVersionId} IS NULL AND ${t.candidateVersion} IS NOT NULL
          AND ${t.reasons} = '[]'::jsonb
        WHEN ${t.status} = 'held' THEN ${t.completedAt} IS NOT NULL
          AND ${t.candidateArtifactId} IS NULL AND ${t.heldVersionId} IS NOT NULL AND ${t.candidateVersion} IS NOT NULL
          AND ${t.reasons} <> '[]'::jsonb
        WHEN ${t.status} IN ('not_ready', 'failed') THEN ${t.completedAt} IS NOT NULL
          AND ${t.candidateArtifactId} IS NULL AND ${t.heldVersionId} IS NULL AND ${t.reasons} <> '[]'::jsonb
        ELSE ${t.completedAt} IS NOT NULL AND ${t.candidateArtifactId} IS NULL AND ${t.heldVersionId} IS NULL
          AND ${t.candidateVersion} IS NULL AND ${t.reasons} = '[]'::jsonb
        END`,
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
    workspaceRowPolicy(t.workspaceId),
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
