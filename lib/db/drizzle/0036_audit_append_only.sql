-- Staff access audit becomes append-only. Updates are always refused. Deletes are
-- refused except for synthetic test identities, which tests and fixture cleanup
-- remove; real staff rows can never be removed. TRUNCATE is refused on the staff
-- audit and role-change history tables.
CREATE FUNCTION valo_staff_access_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (OLD.actor_id LIKE 'synthetic-%' OR OLD.actor_id LIKE 'privacy-fixture-%') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Staff access audit is append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER valo_staff_access_audit_append_only BEFORE UPDATE OR DELETE ON valo_staff_access_audit
  FOR EACH ROW EXECUTE FUNCTION valo_staff_access_audit_guard();
--> statement-breakpoint
CREATE FUNCTION valo_audit_truncate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history cannot be truncated' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER valo_staff_access_audit_no_truncate BEFORE TRUNCATE ON valo_staff_access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION valo_audit_truncate_guard();
--> statement-breakpoint
CREATE TRIGGER valo_staff_role_changes_no_truncate BEFORE TRUNCATE ON valo_staff_role_changes
  FOR EACH STATEMENT EXECUTE FUNCTION valo_audit_truncate_guard();
