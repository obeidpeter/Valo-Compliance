-- Durable scoped workspace data exports. Existing document-job bindings remain intact.
CREATE TABLE valo_workspace_exports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES valo_workspaces(id),
  requested_by text NOT NULL,
  idempotency_key uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'queued',
  version integer NOT NULL DEFAULT 1,
  queue_id uuid NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  retry_cycles integer NOT NULL DEFAULT 0,
  lease_recoveries integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  rows_processed integer NOT NULL DEFAULT 0,
  bytes_prepared integer NOT NULL DEFAULT 0,
  error_code text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valo_workspace_export_status CHECK(status IN ('queued','running','retrying','ready','failed','cancelled','expired')),
  CONSTRAINT valo_workspace_export_counts CHECK(version>0 AND schema_version=2 AND attempts BETWEEN 0 AND 3
    AND retry_cycles BETWEEN 0 AND 2 AND lease_recoveries>=0 AND rows_processed>=0 AND bytes_prepared>=0)
);
CREATE UNIQUE INDEX valo_workspace_export_scope ON valo_workspace_exports(id,workspace_id);
CREATE UNIQUE INDEX valo_workspace_export_request ON valo_workspace_exports(workspace_id,requested_by,idempotency_key);
CREATE UNIQUE INDEX valo_workspace_export_active ON valo_workspace_exports(workspace_id,requested_by)
  WHERE status IN ('queued','running','retrying');
CREATE INDEX valo_workspace_export_dispatch ON valo_workspace_exports(status,next_attempt_at);
--> statement-breakpoint
ALTER TABLE valo_export_objects ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE valo_export_objects ADD COLUMN workspace_export_job_id uuid;
ALTER TABLE valo_export_objects ADD CONSTRAINT valo_export_object_workspace_job_fk
  FOREIGN KEY(workspace_export_job_id,workspace_id) REFERENCES valo_workspace_exports(id,workspace_id);
ALTER TABLE valo_export_objects ADD CONSTRAINT valo_export_object_exact_job
  CHECK((job_id IS NULL) <> (workspace_export_job_id IS NULL));
ALTER TABLE valo_file_assets ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE valo_file_assets ADD COLUMN workspace_export_job_id uuid, ADD COLUMN withdrawn_at timestamptz;
ALTER TABLE valo_file_assets ADD CONSTRAINT valo_file_asset_workspace_job_fk
  FOREIGN KEY(workspace_export_job_id,workspace_id) REFERENCES valo_workspace_exports(id,workspace_id);
ALTER TABLE valo_file_assets ADD CONSTRAINT valo_file_asset_exact_job
  CHECK((job_id IS NULL) <> (workspace_export_job_id IS NULL));
ALTER TABLE valo_file_assets ADD CONSTRAINT valo_file_asset_withdrawal_scope
  CHECK(withdrawn_at IS NULL OR workspace_export_job_id IS NOT NULL);
CREATE UNIQUE INDEX valo_workspace_export_file_unique ON valo_file_assets(workspace_export_job_id);
