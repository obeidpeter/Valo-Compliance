CREATE TABLE valo_workspace_exports (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES valo_workspaces(id),
 requester_id text NOT NULL, request_key uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','preparing','interrupted','ready','cancelled','expired')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 current_attempt_id uuid, lease_until timestamptz, checksum text, size bigint CHECK(size>=0),
 counts jsonb, scope text, error_code text, snapshot_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,workspace_id), UNIQUE(workspace_id,requester_id,request_key),
 CHECK(status<>'ready' OR (checksum IS NOT NULL AND size IS NOT NULL AND current_attempt_id IS NOT NULL AND counts IS NOT NULL))
);
CREATE UNIQUE INDEX valo_workspace_export_one_active ON valo_workspace_exports(workspace_id)
 WHERE status IN ('queued','preparing','interrupted');
CREATE INDEX valo_workspace_export_expiry ON valo_workspace_exports(expires_at);
CREATE TABLE valo_workspace_export_attempts (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, job_id uuid NOT NULL,
 object_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','uploading','ready','cleanup')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,workspace_id) REFERENCES valo_workspace_exports(id,workspace_id)
);
CREATE INDEX valo_workspace_export_cleanup ON valo_workspace_export_attempts(status,created_at);
