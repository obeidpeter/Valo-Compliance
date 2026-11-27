CREATE TABLE valo_access_support (
  id uuid PRIMARY KEY, idempotency_key uuid NOT NULL UNIQUE,
  payload_hash text NOT NULL CHECK(length(payload_hash)=64),
  contact_email text NOT NULL CHECK(length(contact_email)<=254),
  topic text NOT NULL CHECK(topic IN ('account_access','general','content_issue')),
  message text NOT NULL CHECK(length(message) BETWEEN 20 AND 2000),
  status text NOT NULL DEFAULT 'awaiting_staff' CHECK(status='awaiting_staff'),
  notice_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX valo_access_support_queue ON valo_access_support(status,created_at);
--> statement-breakpoint
CREATE TABLE valo_staff_assignments (
  id uuid PRIMARY KEY, identity_id text NOT NULL,
  role text NOT NULL CHECK(role IN ('content','support','finance','system')),
  active boolean NOT NULL DEFAULT true,
  granted_by text NOT NULL CHECK(length(granted_by)>0),
  reason text NOT NULL CHECK(length(reason)>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX valo_staff_identity_role ON valo_staff_assignments(identity_id,role);
--> statement-breakpoint
CREATE TABLE valo_staff_access_audit (
  id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES valo_staff_assignments(id),
  actor_id text NOT NULL, area text NOT NULL,
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
