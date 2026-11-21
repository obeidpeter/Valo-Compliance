-- Key material stays in the secret store. Only immutable version fingerprints
-- are pinned here; old keys are retained by the operator's configured keyring.
CREATE TABLE valo_privacy_key_versions (
  id text PRIMARY KEY,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  pinned_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE valo_privacy_tombstones
  ADD COLUMN key_version text NOT NULL DEFAULT 'session-derived-v1';
