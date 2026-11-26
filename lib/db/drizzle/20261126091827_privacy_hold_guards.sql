-- PRV-003 (docs/architecture/privacy-requests.md, slice 4): a hold of its own on a workspace is kept for good.
-- The one change it takes is its release, once, with who released it, when and why. Its row is removed only
-- with a synthetic test identity's workspace. The table cannot be emptied, and it keeps a history digest
-- (ADM-009); it is new, so its digest starts empty.
CREATE FUNCTION public.valo_privacy_hold_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['released_by', 'released_at', 'release_reason'])
      = (to_jsonb(OLD) - ARRAY['released_by', 'released_at', 'release_reason']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT FROM public.valo_workspaces w WHERE w.id = OLD.workspace_id
      AND (w.owner_identity_id LIKE 'synthetic-%' OR w.owner_identity_id LIKE 'privacy-fixture-%')) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A workspace hold is released once and never removed' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_privacy_hold_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_privacy_holds_guard BEFORE UPDATE OR DELETE ON public.valo_privacy_holds
  FOR EACH ROW EXECUTE FUNCTION public.valo_privacy_hold_guard();--> statement-breakpoint
CREATE TRIGGER valo_privacy_holds_no_truncate BEFORE TRUNCATE ON public.valo_privacy_holds
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_privacy_holds_digest AFTER INSERT OR UPDATE OR DELETE ON public.valo_privacy_holds
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();--> statement-breakpoint

-- Whether a workspace is under a hold of its own. It answers only yes or no, and never why. In a customer
-- request, whose transaction carries its workspace's signed credential, it answers for that workspace alone
-- and no for any other; staff and the worker, with no credential, may ask about any workspace.
CREATE FUNCTION public.valo_workspace_under_hold(p_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT FROM public.valo_privacy_holds h
    WHERE h.workspace_id = p_workspace AND h.released_at IS NULL
      AND p_workspace = coalesce(public.valo_scope_workspace(), p_workspace))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_workspace_under_hold(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_workspace_under_hold(uuid) TO valo_workspace_scope;
