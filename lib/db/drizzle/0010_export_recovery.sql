-- Reviewed additive development migration. One controlled migration owner/path.
ALTER TABLE valo_export_jobs ADD COLUMN lease_recoveries integer NOT NULL DEFAULT 0 CHECK (lease_recoveries >= 0);
CREATE TABLE valo_export_objects (
  object_key text PRIMARY KEY,
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  queue_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','retained','cleanup')),
  cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  next_cleanup_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id,workspace_id) REFERENCES valo_export_jobs(id,workspace_id)
);
CREATE INDEX valo_export_object_cleanup_idx ON valo_export_objects(state,next_cleanup_at);
