-- Additive convergence on the already applied native 0027/0028 tables.
-- Preserve every request, attempt ID, object key, status and historical timestamp.
ALTER TABLE valo_workspace_exports
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 ADD COLUMN queue_id uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN rows_processed integer NOT NULL DEFAULT 0 CHECK(rows_processed >= 0),
 ADD COLUMN bytes_prepared bigint NOT NULL DEFAULT 0 CHECK(bytes_prepared >= 0),
 ADD COLUMN progress_section text;
CREATE INDEX valo_workspace_export_dispatch ON valo_workspace_exports(status,updated_at);
