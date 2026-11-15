-- Additive and inert in development. Never auto-promote a restored database.
CREATE TABLE valo_runtime_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  instance_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  environment text NOT NULL DEFAULT 'development' CHECK (environment IN ('development','production-rehearsal')),
  storage_fingerprint text CHECK (storage_fingerprint ~ '^[a-f0-9]{64}$'),
  CHECK ((environment='development' AND storage_fingerprint IS NULL) OR
         (environment='production-rehearsal' AND storage_fingerprint IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO valo_runtime_identity(singleton) VALUES(true);
