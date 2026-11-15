-- R1 monitoring is confined to registered official sources. It never releases content.
CREATE TABLE valo_source_watches (
 source_id text PRIMARY KEY, url text NOT NULL, risk text NOT NULL CHECK(risk IN ('high','standard')),
 last_snapshot_id uuid REFERENCES valo_source_snapshots(id), last_raw_hash text,
 checked_at timestamptz, failure_code text, next_check_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE valo_source_check_jobs (
 id uuid PRIMARY KEY, source_id text NOT NULL REFERENCES valo_source_watches(source_id),
 day date NOT NULL, status text NOT NULL CHECK(status IN ('pending','running','complete')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), lease_token uuid, lease_until timestamptz,
 snapshot_id uuid REFERENCES valo_source_snapshots(id), result text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_id,day)
);
CREATE INDEX valo_source_check_due ON valo_source_check_jobs(status,lease_until);
CREATE TABLE valo_source_release_bindings (
 target_kind text NOT NULL CHECK(target_kind IN ('content','rule')), target_id uuid NOT NULL,
 source_id text NOT NULL REFERENCES valo_source_watches(source_id), bundle_source_id text NOT NULL, source_hash text NOT NULL,
 snapshot_id uuid NOT NULL REFERENCES valo_source_snapshots(id), raw_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(target_kind,target_id,bundle_source_id)
);
CREATE TABLE valo_source_impacts (
 id uuid PRIMARY KEY, dedupe_key text NOT NULL UNIQUE,
 target_kind text NOT NULL CHECK(target_kind IN ('content','rule')), target_id uuid NOT NULL,
 target_key text NOT NULL, target_version integer NOT NULL,
 source_id text REFERENCES valo_source_watches(source_id), old_snapshot_id uuid, new_snapshot_id uuid,
 reason text NOT NULL, actor_id text NOT NULL, action text NOT NULL CHECK(action IN ('hold','withdraw')),
 phase text NOT NULL DEFAULT 'tasks' CHECK(phase IN ('derived','tasks','assessments','documents','purchases','complete')),
 cursor_id uuid, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX valo_source_impact_queue ON valo_source_impacts(phase,created_at);
CREATE INDEX valo_source_impact_target ON valo_source_impacts(target_kind,target_id);
CREATE TABLE valo_source_dependency_jobs (
 id uuid PRIMARY KEY,source_id text NOT NULL REFERENCES valo_source_watches(source_id),dedupe_key text NOT NULL UNIQUE,
 reason text NOT NULL,new_snapshot_id uuid,observed_hash text,cursor_kind text,cursor_id uuid,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz
);
CREATE INDEX valo_source_dependency_pending ON valo_source_dependency_jobs(status,created_at);
CREATE TABLE valo_source_review_work (
 id uuid PRIMARY KEY, impact_id uuid NOT NULL UNIQUE REFERENCES valo_source_impacts(id),
 status text NOT NULL DEFAULT 'awaiting_authorized_review' CHECK(status IN ('awaiting_authorized_review','superseded_by_eligible_version')),
 replacement_kind text, replacement_id uuid, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE valo_correction_notices (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES valo_workspaces(id),
 impact_id uuid NOT NULL REFERENCES valo_source_impacts(id), entity_kind text NOT NULL, entity_id uuid NOT NULL,
 message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,impact_id,entity_kind,entity_id)
);
CREATE INDEX valo_correction_notice_workspace ON valo_correction_notices(workspace_id,created_at);
CREATE TABLE valo_safety_control_audit (
 id uuid PRIMARY KEY, request_key uuid NOT NULL UNIQUE, actor_id text NOT NULL, assignment_id uuid NOT NULL REFERENCES valo_staff_assignments(id),
 area text NOT NULL, action text NOT NULL, target text NOT NULL, reason text NOT NULL,
 previous jsonb NOT NULL, current jsonb NOT NULL, payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION valo_source_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Source evidence and safety audit records are append only'; END $$;
CREATE TRIGGER valo_source_binding_immutable BEFORE UPDATE OR DELETE ON valo_source_release_bindings FOR EACH ROW EXECUTE FUNCTION valo_source_append_only();
CREATE TRIGGER valo_correction_notice_immutable BEFORE UPDATE ON valo_correction_notices FOR EACH ROW EXECUTE FUNCTION valo_source_append_only();
CREATE TRIGGER valo_safety_audit_immutable BEFORE UPDATE OR DELETE ON valo_safety_control_audit FOR EACH ROW EXECUTE FUNCTION valo_source_append_only();
CREATE FUNCTION valo_source_impact_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'phase'-'cursor_id'-'completed_at') IS DISTINCT FROM (to_jsonb(OLD)-'phase'-'cursor_id'-'completed_at')
 THEN RAISE EXCEPTION 'Source impact identity and cause are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER valo_source_impact_immutable BEFORE UPDATE OR DELETE ON valo_source_impacts FOR EACH ROW EXECUTE FUNCTION valo_source_impact_identity();
-- The bounded publisher can inspect and bind evidence, but cannot clear a hold.
GRANT SELECT ON valo_source_watches,valo_source_snapshots,valo_source_release_bindings,valo_source_impacts TO valo_content_publisher_dev;
GRANT INSERT ON valo_source_release_bindings TO valo_content_publisher_dev;
GRANT SELECT ON valo_source_review_work TO valo_content_publisher_dev;
GRANT UPDATE(status,replacement_kind,replacement_id,completed_at) ON valo_source_review_work TO valo_content_publisher_dev;
