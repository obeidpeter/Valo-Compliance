-- Registered migration 0022; no automatic startup DDL.
-- Existing unsigned journals are intentionally held, never silently attested.
ALTER TABLE valo_privacy_tombstones
  ADD COLUMN erasure_seal jsonb,
  ADD COLUMN replay_state jsonb,
  ADD COLUMN next_replay_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX valo_privacy_tombstone_identity ON valo_privacy_tombstones(identity_hash);
CREATE INDEX valo_privacy_tombstone_replay ON valo_privacy_tombstones(next_replay_at);
--> statement-breakpoint
-- Status/attempt receipts remain writable. A sealed key set is immutable.
-- Fixture cleanup must remove its tombstone before deleting its object journal.
CREATE FUNCTION valo_guard_erasure_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid;
BEGIN
  target_case := CASE WHEN TG_OP='INSERT' THEN NEW.case_id ELSE OLD.case_id END;
  IF EXISTS (SELECT 1 FROM valo_privacy_tombstones WHERE case_id=target_case
      AND erasure_seal->>'inventoryHash' IS NOT NULL) THEN
    RAISE EXCEPTION 'Sealed erasure inventory is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.case_id IS DISTINCT FROM OLD.case_id AND EXISTS
    (SELECT 1 FROM valo_privacy_tombstones WHERE case_id=NEW.case_id AND erasure_seal->>'inventoryHash' IS NOT NULL) THEN
    RAISE EXCEPTION 'Sealed erasure inventory is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER valo_erasure_inventory_immutable
  BEFORE INSERT OR DELETE OR UPDATE OF case_id,workspace_id,object_key ON valo_privacy_erasure_objects
  FOR EACH ROW EXECUTE FUNCTION valo_guard_erasure_inventory();

--> statement-breakpoint
-- A concurrent writer cannot temporarily unseal a captured inventory and add
-- candidates between validation and dispatch. Completion/signing may advance.
CREATE FUNCTION valo_guard_erasure_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.erasure_seal->>'inventoryHash' IS NOT NULL AND (
    NEW.erasure_seal->>'inventoryHash' IS DISTINCT FROM OLD.erasure_seal->>'inventoryHash' OR
    NEW.erasure_seal->>'inventoryCount' IS DISTINCT FROM OLD.erasure_seal->>'inventoryCount' OR
    NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
    NEW.identity_hash IS DISTINCT FROM OLD.identity_hash OR NEW.key_version IS DISTINCT FROM OLD.key_version) THEN
    RAISE EXCEPTION 'Sealed erasure binding cannot be reset' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER valo_erasure_binding_immutable BEFORE UPDATE ON valo_privacy_tombstones
  FOR EACH ROW EXECUTE FUNCTION valo_guard_erasure_binding();
