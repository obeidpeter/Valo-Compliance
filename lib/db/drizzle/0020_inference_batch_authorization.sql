-- No approved records are seeded. This is not spending authorization.
CREATE TABLE valo_inference_batches (
  id text PRIMARY KEY,
  policy_hash text NOT NULL,
  manifest_hash text NOT NULL,
  manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
  enabled boolean NOT NULL DEFAULT false,
  approved_by text,
  approval_reference text,
  approved_at timestamptz,
  expires_at timestamptz NOT NULL,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valo_batch_approval_fields CHECK (
    NOT enabled OR (approved_by IS NOT NULL AND approval_reference IS NOT NULL AND approved_at IS NOT NULL)
  )
);
--> statement-breakpoint
-- Approval freezes the allowlist and its expiry. Revocation may only disable
-- it; a changed manifest or reactivation needs a new approval record.
CREATE FUNCTION valo_guard_inference_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approved_at IS NOT NULL AND (
    NEW.manifest IS DISTINCT FROM OLD.manifest OR
    NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash OR
    NEW.policy_hash IS DISTINCT FROM OLD.policy_hash OR
    NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
    NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
    NEW.approval_reference IS DISTINCT FROM OLD.approval_reference OR
    NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
    (NOT OLD.enabled AND NEW.enabled)
  ) THEN RAISE EXCEPTION 'Approved inference work is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER valo_inference_batch_immutable BEFORE UPDATE ON valo_inference_batches
  FOR EACH ROW EXECUTE FUNCTION valo_guard_inference_batch();
