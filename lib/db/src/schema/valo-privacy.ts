import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { valoWorkspaces } from "./valo-workspaces";
import { valoSupportTickets } from "./valo-support";
export type PrivacyStep = {
  system: string;
  status: "pending" | "running" | "confirmed" | "held" | "failed" | "not_applicable";
  detail: string;
  profileRevisionAtRequest?: number;
  profileHashAtRequest?: string;
};
export const valoPrivacyCases = pgTable(
  "valo_privacy_cases",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    requesterIdentityId: text("requester_identity_id").notNull(),
    kind: text("kind", { enum: ["correction", "export", "deletion"] }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    message: text("message").notNull(),
    status: text("status", {
      enum: [
        "awaiting_verification",
        "verified",
        "assigned",
        "in_progress",
        "needs_information",
        "held",
        "partially_fulfilled",
        "fulfilled",
        "rejected",
        "cancelled",
        "failed",
      ],
    })
      .notNull()
      .default("awaiting_verification"),
    version: integer("version").notNull().default(1),
    assignedIdentityId: text("assigned_identity_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    resultScope: text("result_scope")
      .notNull()
      .default("No result has been prepared or provider action confirmed."),
    steps: jsonb("steps").$type<PrivacyStep[]>().notNull().default([]),
    lastEventHash: text("last_event_hash").notNull(),
    erasurePhase: text("erasure_phase").notNull().default("not_started"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_privacy_case_workspace").on(t.id, t.workspaceId),
    uniqueIndex("valo_privacy_case_idempotency").on(t.workspaceId, t.idempotencyKey),
    index("valo_privacy_case_queue").on(t.status, t.createdAt),
    foreignKey({
      columns: [t.id, t.workspaceId],
      foreignColumns: [valoSupportTickets.id, valoSupportTickets.workspaceId],
    }),
    check("valo_privacy_cases_kind_check", sql`${t.kind} IN ('correction', 'export', 'deletion')`),
    check("valo_privacy_cases_last_event_hash_check", sql`length(${t.lastEventHash}) = 64`),
    check("valo_privacy_cases_message_check", sql`length(${t.message}) BETWEEN 10 AND 1500`),
    check("valo_privacy_cases_payload_hash_check", sql`length(${t.payloadHash}) = 64`),
    check(
      "valo_privacy_cases_status_check",
      sql`${t.status} IN ('awaiting_verification', 'verified', 'assigned', 'in_progress', 'needs_information', 'held', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled', 'failed')`,
    ),
    check("valo_privacy_cases_steps_check", sql`jsonb_typeof(${t.steps}) = 'array'`),
    check("valo_privacy_cases_version_check", sql`${t.version} > 0`),
  ],
);
export const valoPrivacyEvents = pgTable(
  "valo_privacy_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    caseId: uuid("case_id").notNull(),
    sequence: integer("sequence").notNull(),
    actorType: text("actor_type", { enum: ["customer", "staff", "worker"] }).notNull(),
    actorHash: text("actor_hash").notNull(),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    previousHash: text("previous_hash").notNull(),
    stateHash: text("state_hash").notNull(),
    eventHash: text("event_hash").notNull(),
    keyVersion: text("key_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("valo_privacy_event_sequence").on(t.caseId, t.sequence),
    foreignKey({
      columns: [t.caseId, t.workspaceId],
      foreignColumns: [valoPrivacyCases.id, valoPrivacyCases.workspaceId],
    }),
    check("valo_privacy_events_actor_hash_check", sql`length(${t.actorHash}) = 64`),
    check("valo_privacy_events_actor_type_check", sql`${t.actorType} IN ('customer', 'staff', 'worker')`),
    check("valo_privacy_events_event_hash_check", sql`length(${t.eventHash}) = 64`),
    check("valo_privacy_events_previous_hash_check", sql`length(${t.previousHash}) = 64`),
    check("valo_privacy_events_sequence_check", sql`${t.sequence} > 0`),
    check("valo_privacy_events_state_hash_check", sql`length(${t.stateHash}) = 64`),
  ],
);
export const valoPrivacyMessages = pgTable(
  "valo_privacy_messages",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    caseId: uuid("case_id").notNull(),
    replyToVersion: integer("reply_to_version").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_privacy_message_reply").on(t.caseId, t.replyToVersion),
    foreignKey({
      name: "valo_privacy_message_case",
      columns: [t.caseId, t.workspaceId],
      foreignColumns: [valoPrivacyCases.id, valoPrivacyCases.workspaceId],
    }),
    check("valo_privacy_messages_body_check", sql`length(${t.body}) BETWEEN 1 AND 4000`),
    check("valo_privacy_messages_reply_to_version_check", sql`${t.replyToVersion} > 0`),
  ],
);
export const valoPrivacyTombstones = pgTable(
  "valo_privacy_tombstones",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    caseId: uuid("case_id").notNull().unique(),
    identityHash: text("identity_hash").notNull(),
    phase: text("phase").notNull(),
    keyVersion: text("key_version").notNull().default("session-derived-v1"),
    erasureSeal: jsonb("erasure_seal").$type<object>(),
    replayState: jsonb("replay_state").$type<object>(),
    nextReplayAt: timestamp("next_replay_at", { withTimezone: true }).notNull().defaultNow(),
    privateObjectKey: text("private_object_key"),
    checksum: text("checksum"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_privacy_tombstone_workspace").on(t.workspaceId),
    index("valo_privacy_tombstone_identity").on(t.identityHash),
    index("valo_privacy_tombstone_replay").on(t.nextReplayAt),
    check("valo_privacy_tombstones_checksum_check", sql`${t.checksum} IS NULL OR length(${t.checksum}) = 64`),
    check("valo_privacy_tombstones_identity_hash_check", sql`length(${t.identityHash}) = 64`),
  ],
);
// Intentionally independent of export-job/file FKs: deletion instructions must
// outlive the private document records they remove.
export const valoPrivacyErasureObjects = pgTable(
  "valo_privacy_erasure_objects",
  {
    workspaceId: uuid("workspace_id").notNull(),
    caseId: uuid("case_id").notNull(),
    objectKey: text("object_key").notNull(),
    status: text("status", { enum: ["pending", "deleted", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.objectKey] }),
    index("valo_privacy_erasure_workspace").on(t.workspaceId),
    check("valo_privacy_erasure_objects_status_check", sql`${t.status} IN ('pending', 'deleted', 'failed')`),
  ],
);
