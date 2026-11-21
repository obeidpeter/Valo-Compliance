-- Additive, reviewed SQL. Never change a user's confirmed due date to retry.
ALTER TABLE valo_reminder_outbox
 ADD COLUMN next_attempt_at timestamptz,
 ADD COLUMN last_attempt_at timestamptz,
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_until timestamptz;
CREATE INDEX valo_reminder_retry_idx ON valo_reminder_outbox(status,next_attempt_at);
