-- Integration must assign the next journal index; no automatic startup DDL.
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
