-- Whom a staff-library edition reaches: each workspace that bought its template (an active entitlement to
-- any of its editions, under a verified order) or made documents from this edition, once, with whether it
-- bought it and how many documents it made (docs/architecture/library-holds.md, slice 1). The staff library
-- shows these counts before a withdrawal, and the edition's notices are written from the same rows. It is
-- not granted to customer requests, which see only their own workspace.
CREATE FUNCTION public.valo_manual_edition_reach(target uuid)
RETURNS TABLE(workspace_id uuid, held boolean, documents integer)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT affected.workspace_id, bool_or(affected.held), sum(affected.documents)::integer
  FROM (
    SELECT e.workspace_id, true AS held, 0 AS documents
      FROM public.valo_manual_library edition
      JOIN public.valo_manual_library b ON b.item_id = edition.item_id
      JOIN public.valo_entitlements e ON e.content_version_id = b.id
      JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
     WHERE edition.id = target AND e.status = 'active' AND o.status = 'verified_success'
    UNION ALL
    SELECT d.workspace_id, false, 1
      FROM public.valo_documents d
     WHERE d.library_edition = target OR d.form_edition = target
  ) affected
  GROUP BY affected.workspace_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_manual_edition_reach(uuid) FROM PUBLIC;--> statement-breakpoint
-- The notices of a replaced or withdrawn library edition, now written from the rows its reach gives, so the
-- counts staff see before a withdrawal are those its notices reach. Otherwise as the manual changes migration
-- left it.
CREATE OR REPLACE FUNCTION public.valo_note_library_edition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE target public.valo_manual_library%ROWTYPE;
DECLARE change text;
DECLARE replacement integer;
DECLARE why text;
BEGIN
  IF NEW.kind NOT IN ('template', 'premium_template') THEN RETURN NULL; END IF;
  IF OLD.state = 'published' AND NEW.state = 'withdrawn' THEN
    target := NEW;
    change := 'withdrawn';
    SELECT w.reason INTO why FROM public.valo_manual_withdrawals w WHERE w.edition = NEW.id;
  ELSIF OLD.state = 'draft' AND NEW.state = 'published' THEN
    SELECT * INTO target FROM public.valo_manual_library m
     WHERE m.item_id = NEW.item_id AND m.version < NEW.version AND m.published_at IS NOT NULL
     ORDER BY m.version DESC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    change := 'replaced';
    replacement := NEW.version;
    SELECT c.note INTO why FROM public.valo_manual_changes c WHERE c.edition = NEW.id;
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO public.valo_edition_notices(workspace_id, route, edition, kind, title, version,
    replacement_version, reason, held, documents)
  SELECT reach.workspace_id, 'library', target.id, change, target.title, target.version,
    replacement, why, reach.held, reach.documents
  FROM public.valo_manual_edition_reach(target.id) reach
  ON CONFLICT (workspace_id, edition, kind) DO NOTHING;
  RETURN NULL;
END $$;
