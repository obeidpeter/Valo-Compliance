import {pgTable,uuid,text,integer,timestamp,jsonb,uniqueIndex,index,foreignKey,primaryKey} from "drizzle-orm/pg-core";
import {valoWorkspaces} from "./valo-workspaces";
import {valoSupportTickets} from "./valo-support";
export type PrivacyStep={system:string;status:"pending"|"running"|"confirmed"|"held"|"failed"|"not_applicable";detail:string;
  profileRevisionAtRequest?:number;profileHashAtRequest?:string};
export const valoPrivacyCases=pgTable("valo_privacy_cases",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  requesterIdentityId:text("requester_identity_id").notNull(),
  kind:text("kind",{enum:["correction","export","deletion"]}).notNull(),
  idempotencyKey:uuid("idempotency_key").notNull(),payloadHash:text("payload_hash").notNull(),
  message:text("message").notNull(),
  status:text("status",{enum:["awaiting_verification","verified","assigned","in_progress","needs_information","held","partially_fulfilled","fulfilled","rejected","cancelled","failed"]}).notNull().default("awaiting_verification"),
  version:integer("version").notNull().default(1),
  assignedIdentityId:text("assigned_identity_id"),verifiedAt:timestamp("verified_at",{withTimezone:true}),
  resultJson:jsonb("result_json").$type<Record<string,unknown>>(),
  resultScope:text("result_scope").notNull().default("No result has been prepared or provider action confirmed."),
  steps:jsonb("steps").$type<PrivacyStep[]>().notNull().default([]),
  lastEventHash:text("last_event_hash").notNull(),
  erasurePhase:text("erasure_phase").notNull().default("not_started"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_privacy_case_workspace").on(t.id,t.workspaceId),
  uniqueIndex("valo_privacy_case_idempotency").on(t.workspaceId,t.idempotencyKey),
  index("valo_privacy_case_queue").on(t.status,t.createdAt),
  foreignKey({columns:[t.id,t.workspaceId],foreignColumns:[valoSupportTickets.id,valoSupportTickets.workspaceId]})]);
export const valoPrivacyEvents=pgTable("valo_privacy_events",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull(),caseId:uuid("case_id").notNull(),
  sequence:integer("sequence").notNull(),actorType:text("actor_type",{enum:["customer","staff","worker"]}).notNull(),
  actorHash:text("actor_hash").notNull(),action:text("action").notNull(),reason:text("reason").notNull(),
  previousHash:text("previous_hash").notNull(),stateHash:text("state_hash").notNull(),eventHash:text("event_hash").notNull(),
  keyVersion:text("key_version").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),
},t=>[uniqueIndex("valo_privacy_event_sequence").on(t.caseId,t.sequence),
  foreignKey({columns:[t.caseId,t.workspaceId],foreignColumns:[valoPrivacyCases.id,valoPrivacyCases.workspaceId]})]);
export const valoPrivacyTombstones=pgTable("valo_privacy_tombstones",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull(),caseId:uuid("case_id").notNull().unique(),
  identityHash:text("identity_hash").notNull(),phase:text("phase").notNull(),
  keyVersion:text("key_version").notNull().default("session-derived-v1"),
  erasureSeal:jsonb("erasure_seal").$type<object>(),
  replayState:jsonb("replay_state").$type<object>(),
  nextReplayAt:timestamp("next_replay_at",{withTimezone:true}).notNull().defaultNow(),
  privateObjectKey:text("private_object_key"),checksum:text("checksum"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("valo_privacy_tombstone_workspace").on(t.workspaceId),
  index("valo_privacy_tombstone_identity").on(t.identityHash),
  index("valo_privacy_tombstone_replay").on(t.nextReplayAt)]);
// Intentionally independent of export-job/file FKs: deletion instructions must
// outlive the private document records they remove.
export const valoPrivacyErasureObjects=pgTable("valo_privacy_erasure_objects",{
  workspaceId:uuid("workspace_id").notNull(),caseId:uuid("case_id").notNull(),objectKey:text("object_key").notNull(),
  status:text("status",{enum:["pending","deleted","failed"]}).notNull().default("pending"),
  attempts:integer("attempts").notNull().default(0),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.caseId,t.objectKey]}),index("valo_privacy_erasure_workspace").on(t.workspaceId)]);
