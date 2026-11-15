-- Scheduling metadata only. Preserve every key, status, cleanup timestamp and privacy record.
ALTER TABLE valo_workspace_export_attempts
 ADD COLUMN next_cleanup_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN cleanup_attempts integer NOT NULL DEFAULT 0 CHECK(cleanup_attempts>=0),
 ADD COLUMN cleanup_error_code text CHECK(cleanup_error_code IN
  ('INVALID_PRIVATE_KEY','PRIVACY_HOLD','PRIVACY_REPLAY_OWNED','STORAGE_DELETE_FAILED'));
--> statement-breakpoint
-- Historical cleanup_checked_at means an earlier check, not independently proved deletion.
-- Preserve the existing hourly recheck boundary; new reservations are immediately eligible.
UPDATE valo_workspace_export_attempts SET next_cleanup_at=
 CASE WHEN cleanup_checked_at IS NULL THEN now() ELSE cleanup_checked_at+interval '1 hour' END;
--> statement-breakpoint
CREATE INDEX valo_workspace_cleanup_due ON valo_workspace_export_attempts(next_cleanup_at,id);
