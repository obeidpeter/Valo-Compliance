-- ADM-006 (docs/architecture/commercial-settings.md, slice 4b): a bundle's versions are versioned as prices
-- are. A version never changes in place: the next one is its own row, and the only change to a row is
-- closing it, once, from now or later. A version is never removed, and neither table can be emptied. Every
-- insert and close is logged in valo_bundle_changes, which is append-only. Both are histories, so both keep
-- a digest (ADM-009); they are new, so their digests start empty. A version holds each of its templates
-- once, and each is a premium template of the staff library that has been released. A customer request
-- reads neither table.
CREATE FUNCTION public.valo_bundle_versioned() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A bundle''s version is never removed: a new version closes it' USING ERRCODE = '23514';
  END IF;
  -- Every column but effective_to, including any a later migration adds.
  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION 'A bundle''s version never changes in place: a change needs a new version'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to
    AND (OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL OR NEW.effective_to < now()) THEN
    RAISE EXCEPTION 'A bundle''s version is closed once, from now or later' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_bundle_versioned() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_bundles_versioned BEFORE UPDATE OR DELETE ON public.valo_bundles
  FOR EACH ROW EXECUTE FUNCTION public.valo_bundle_versioned();--> statement-breakpoint
-- What a version holds: each template once, and each a premium template of the staff library that has been
-- released. An item's kind is fixed by its first draft, and a released version of it is never removed, so
-- what this checks at the insert stays true.
CREATE FUNCTION public.valo_bundle_items_hold() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF array_ndims(NEW.items) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'A bundle lists each of its templates once' USING ERRCODE = '23514';
  END IF;
  IF array_position(NEW.items, NULL) IS NOT NULL
    OR (SELECT count(DISTINCT i.item) FROM unnest(NEW.items) AS i(item)) <> cardinality(NEW.items) THEN
    RAISE EXCEPTION 'A bundle lists each of its templates once' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT FROM unnest(NEW.items) AS i(item)
     WHERE NOT EXISTS (
       SELECT FROM public.valo_manual_library m
        WHERE m.item_id = i.item AND m.kind = 'premium_template' AND m.published_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'A bundle holds only premium templates of the staff library that have been released'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_bundle_items_hold() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_bundles_items_hold BEFORE INSERT ON public.valo_bundles
  FOR EACH ROW EXECUTE FUNCTION public.valo_bundle_items_hold();--> statement-breakpoint
CREATE FUNCTION public.valo_bundle_change_log() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.valo_bundle_changes(bundle_id, action, bundle) VALUES (NEW.id, 'created', to_jsonb(NEW));
  ELSIF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    INSERT INTO public.valo_bundle_changes(bundle_id, action, bundle) VALUES (NEW.id, 'closed', to_jsonb(NEW));
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_bundle_change_log() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_bundles_change_log AFTER INSERT OR UPDATE ON public.valo_bundles
  FOR EACH ROW EXECUTE FUNCTION public.valo_bundle_change_log();--> statement-breakpoint
CREATE FUNCTION public.valo_bundle_changes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Bundle history is append-only' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_bundle_changes_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_bundle_changes_append_only BEFORE UPDATE OR DELETE ON public.valo_bundle_changes
  FOR EACH ROW EXECUTE FUNCTION public.valo_bundle_changes_guard();--> statement-breakpoint
CREATE TRIGGER valo_bundles_no_truncate BEFORE TRUNCATE ON public.valo_bundles
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_bundle_changes_no_truncate BEFORE TRUNCATE ON public.valo_bundle_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_bundles_digest AFTER INSERT OR UPDATE OR DELETE ON public.valo_bundles
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();--> statement-breakpoint
CREATE TRIGGER valo_bundle_changes_digest AFTER INSERT OR UPDATE OR DELETE ON public.valo_bundle_changes
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();
