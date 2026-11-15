CREATE TABLE valo_support_cases (
 id uuid PRIMARY KEY, source_kind text NOT NULL CHECK (source_kind IN ('workspace','access')),
 ticket_id uuid UNIQUE REFERENCES valo_support_tickets(id) ON DELETE CASCADE,
 access_id uuid UNIQUE REFERENCES valo_access_support(id) ON DELETE CASCADE,
 workspace_id uuid REFERENCES valo_workspaces(id),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','awaiting_customer','resolved')),
 assigned_to text, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_support_case_source CHECK ((source_kind='workspace' AND ticket_id IS NOT NULL AND access_id IS NULL AND workspace_id IS NOT NULL)
 OR (source_kind='access' AND access_id IS NOT NULL AND ticket_id IS NULL AND workspace_id IS NULL)),
 CONSTRAINT valo_support_case_workspace FOREIGN KEY(ticket_id,workspace_id) REFERENCES valo_support_tickets(id,workspace_id) ON DELETE CASCADE
);
CREATE INDEX valo_support_case_queue ON valo_support_cases(status,updated_at);
CREATE TABLE valo_support_messages (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES valo_support_cases(id) ON DELETE CASCADE,
 workspace_id uuid REFERENCES valo_workspaces(id), author_id text NOT NULL,
 author_kind text NOT NULL CHECK (author_kind IN ('customer','staff')),
 visibility text NOT NULL CHECK (visibility IN ('customer','internal')),
 body text NOT NULL CHECK (char_length(body) BETWEEN 8 AND 4000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX valo_support_message_case ON valo_support_messages(case_id,created_at);
CREATE TABLE valo_support_actions (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES valo_support_cases(id) ON DELETE CASCADE,
 idempotency_key uuid NOT NULL, actor_id text NOT NULL, payload_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT valo_support_action_request UNIQUE(case_id,actor_id,idempotency_key)
);
CREATE TABLE valo_support_events (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES valo_support_cases(id) ON DELETE CASCADE,
 actor_id text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE valo_support_escalations (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES valo_support_cases(id) ON DELETE CASCADE,
 target_kind text NOT NULL CHECK (target_kind IN ('content','rule')), target_id uuid NOT NULL,
 target_hash text NOT NULL, target_version integer NOT NULL CHECK (target_version > 0), reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 4000),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','acknowledged','resolved')),
 source_impact_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX valo_support_escalation_queue ON valo_support_escalations(status,created_at);
CREATE FUNCTION valo_support_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM valo_support_cases WHERE id=OLD.case_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Support action and event history is append only while its case is retained';
END $$;
CREATE TRIGGER valo_support_events_immutable BEFORE UPDATE OR DELETE ON valo_support_events FOR EACH ROW EXECUTE FUNCTION valo_support_audit_immutable();
CREATE TRIGGER valo_support_actions_immutable BEFORE UPDATE OR DELETE ON valo_support_actions FOR EACH ROW EXECUTE FUNCTION valo_support_audit_immutable();
-- Existing durable intake becomes an open workflow, not a fabricated reply,
-- assignment, delivery or resolution. Preserve every original ticket/reference.
INSERT INTO valo_support_cases(id,source_kind,ticket_id,workspace_id,created_at,updated_at)
SELECT id,'workspace',id,workspace_id,created_at,created_at FROM valo_support_tickets
WHERE NOT EXISTS (SELECT 1 FROM valo_privacy_tombstones p WHERE p.workspace_id=valo_support_tickets.workspace_id);
INSERT INTO valo_support_cases(id,source_kind,access_id,created_at,updated_at)
SELECT id,'access',id,created_at,created_at FROM valo_access_support;
