-- Do not infer first-attempt times for historical/unconfirmed deliveries.
ALTER TABLE valo_reminder_outbox ADD COLUMN first_attempt_at timestamptz;
