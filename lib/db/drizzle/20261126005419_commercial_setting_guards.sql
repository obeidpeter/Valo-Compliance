-- ADM-006 (docs/architecture/commercial-settings.md, slice 3): the owner's commercial settings are
-- versioned as prices are. A setting's value never changes in place: a new value is its own row, and the
-- only change to a row is closing it, once, from now or later. A setting is never removed, and neither
-- table can be emptied. Every insert and close is logged in valo_commercial_setting_changes, which is
-- append-only. Both are histories, so both keep a digest (ADM-009); they are new, so their digests start
-- empty. A customer request reads a setting only through valo_commercial_setting, which returns the value
-- in effect now and nothing else.
CREATE FUNCTION public.valo_commercial_setting_versioned() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A commercial setting is never removed: a new value closes it' USING ERRCODE = '23514';
  END IF;
  -- Every column but effective_to, including any a later migration adds.
  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION 'A setting''s value never changes in place: a new value needs its own row'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to
    AND (OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL OR NEW.effective_to < now()) THEN
    RAISE EXCEPTION 'A setting is closed once, from now or later' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_commercial_setting_versioned() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_commercial_settings_versioned BEFORE UPDATE OR DELETE ON public.valo_commercial_settings
  FOR EACH ROW EXECUTE FUNCTION public.valo_commercial_setting_versioned();--> statement-breakpoint
CREATE FUNCTION public.valo_commercial_setting_change_log() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.valo_commercial_setting_changes(setting_id, action, setting)
      VALUES (NEW.id, 'created', to_jsonb(NEW));
  ELSIF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    INSERT INTO public.valo_commercial_setting_changes(setting_id, action, setting)
      VALUES (NEW.id, 'closed', to_jsonb(NEW));
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_commercial_setting_change_log() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_commercial_settings_change_log AFTER INSERT OR UPDATE ON public.valo_commercial_settings
  FOR EACH ROW EXECUTE FUNCTION public.valo_commercial_setting_change_log();--> statement-breakpoint
CREATE FUNCTION public.valo_commercial_setting_changes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Commercial setting history is append-only' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_commercial_setting_changes_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_commercial_setting_changes_append_only BEFORE UPDATE OR DELETE
  ON public.valo_commercial_setting_changes
  FOR EACH ROW EXECUTE FUNCTION public.valo_commercial_setting_changes_guard();--> statement-breakpoint
CREATE TRIGGER valo_commercial_settings_no_truncate BEFORE TRUNCATE ON public.valo_commercial_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_commercial_setting_changes_no_truncate BEFORE TRUNCATE
  ON public.valo_commercial_setting_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_commercial_settings_digest AFTER INSERT OR UPDATE OR DELETE
  ON public.valo_commercial_settings
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();--> statement-breakpoint
CREATE TRIGGER valo_commercial_setting_changes_digest AFTER INSERT OR UPDATE OR DELETE
  ON public.valo_commercial_setting_changes
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();--> statement-breakpoint
-- The value of a setting in effect now, or none, when the code reads the setting's default. A customer
-- request may call it (lib/db/scripts/workspace-row-security.mjs, WORKSPACE_SCOPE_FUNCTIONS); it returns
-- a value and nothing else.
CREATE FUNCTION public.valo_commercial_setting(wanted text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.value FROM public.valo_commercial_settings s
   WHERE s.key = wanted AND s.effective_from <= now() AND (s.effective_to IS NULL OR s.effective_to > now())
   ORDER BY s.effective_from DESC
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_commercial_setting(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_commercial_setting(text) TO valo_workspace_scope;
