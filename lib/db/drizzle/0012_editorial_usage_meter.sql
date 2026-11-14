-- Reviewed additive development migration, through the existing journal only.
-- Retain every old reservation; unknown historic usage remains NULL, not zero.
ALTER TABLE valo_publication_ai_attempts
 ADD COLUMN request_hash text,
 ADD COLUMN request_meter jsonb,
 ADD COLUMN outcome text NOT NULL DEFAULT 'legacy_unmetered',
 ADD COLUMN provider_response_id text,
 ADD COLUMN input_tokens integer CHECK(input_tokens >= 0),
 ADD COLUMN output_tokens integer CHECK(output_tokens >= 0),
 ADD COLUMN error_code text,
 ADD COLUMN completed_at timestamptz;
CREATE INDEX valo_publication_attempt_request_idx
 ON valo_publication_ai_attempts(candidate_hash,role,request_hash);
