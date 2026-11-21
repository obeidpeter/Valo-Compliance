-- Development-reviewed additive lifecycle. No production startup DDL.
CREATE UNIQUE INDEX valo_support_ticket_workspace ON valo_support_tickets(id,workspace_id);
--> statement-breakpoint
ALTER TABLE valo_staff_assignments DROP CONSTRAINT valo_staff_assignments_role_check;
ALTER TABLE valo_staff_assignments ADD CONSTRAINT valo_staff_assignments_role_check
  CHECK(role IN ('content','support','finance','system','privacy'));
--> statement-breakpoint
CREATE TABLE valo_privacy_cases (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES valo_workspaces(id),
  requester_identity_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('correction','export','deletion')),
  idempotency_key uuid NOT NULL,payload_hash text NOT NULL CHECK(length(payload_hash)=64),
  message text NOT NULL CHECK(length(message) BETWEEN 10 AND 1500),
  status text NOT NULL DEFAULT 'awaiting_verification' CHECK(status IN
    ('awaiting_verification','verified','assigned','in_progress','needs_information','held','partially_fulfilled','fulfilled','rejected','cancelled','failed')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),assigned_identity_id text,verified_at timestamptz,
  result_json jsonb,result_scope text NOT NULL DEFAULT 'No result has been prepared or provider action confirmed.',
  steps jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(steps)='array'),
  last_event_hash text NOT NULL CHECK(length(last_event_hash)=64),
  erasure_phase text NOT NULL DEFAULT 'not_started',
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(id,workspace_id) REFERENCES valo_support_tickets(id,workspace_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX valo_privacy_case_workspace ON valo_privacy_cases(id,workspace_id);
CREATE UNIQUE INDEX valo_privacy_case_idempotency ON valo_privacy_cases(workspace_id,idempotency_key);
CREATE INDEX valo_privacy_case_queue ON valo_privacy_cases(status,created_at);
CREATE TABLE valo_privacy_events (
  id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL,
  sequence integer NOT NULL CHECK(sequence>0),
  actor_type text NOT NULL CHECK(actor_type IN ('customer','staff','worker')),
  actor_hash text NOT NULL CHECK(length(actor_hash)=64),action text NOT NULL,reason text NOT NULL,
  previous_hash text NOT NULL CHECK(length(previous_hash)=64),state_hash text NOT NULL CHECK(length(state_hash)=64),
  event_hash text NOT NULL CHECK(length(event_hash)=64),key_version text NOT NULL,created_at timestamptz NOT NULL,
  FOREIGN KEY(case_id,workspace_id) REFERENCES valo_privacy_cases(id,workspace_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX valo_privacy_event_sequence ON valo_privacy_events(case_id,sequence);
CREATE TABLE valo_privacy_tombstones (
  id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL CONSTRAINT valo_privacy_tombstones_case_id_unique UNIQUE,
  identity_hash text NOT NULL CHECK(length(identity_hash)=64),phase text NOT NULL,
  private_object_key text,checksum text CHECK(checksum IS NULL OR length(checksum)=64),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX valo_privacy_tombstone_workspace ON valo_privacy_tombstones(workspace_id);
