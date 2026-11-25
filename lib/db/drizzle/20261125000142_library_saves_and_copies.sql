ALTER TABLE "valo_documents" ADD COLUMN "library_edition" uuid;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD CONSTRAINT "valo_documents_library_edition_valo_manual_library_id_fk" FOREIGN KEY ("library_edition") REFERENCES "public"."valo_manual_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD CONSTRAINT "valo_document_library_edition" CHECK ("valo_documents"."library_edition" IS NULL OR ("valo_documents"."form_edition" IS NULL AND "valo_documents"."template_version_id" IS NULL));--> statement-breakpoint
-- A document copied from a staff-library template (docs/architecture/library-entries.md, slice 3)
-- records the release it was copied from: written once, from a released free template, and never
-- changed. The scoped role cannot read the editorial table, so the check runs as the owner.
CREATE FUNCTION public.valo_guard_document_library_edition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.library_edition IS DISTINCT FROM OLD.library_edition THEN
      RAISE EXCEPTION 'A document keeps the template release it was copied from';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.library_edition IS NOT NULL AND NOT EXISTS (
      SELECT FROM public.valo_manual_library m
      WHERE m.id = NEW.library_edition AND m.kind = 'template' AND m.state = 'published') THEN
    RAISE EXCEPTION 'A copy is made only of a released free template';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_document_library_edition() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_document_library_edition BEFORE INSERT OR UPDATE ON public.valo_documents
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_document_library_edition();--> statement-breakpoint
-- The staff library's released templates, as a workspace saves and is suggested them: what the
-- library lists of each, never its text beyond the summary a visitor sees, its file or its form text.
-- Nothing for an unscoped session.
CREATE FUNCTION public.valo_live_manual_templates()
RETURNS TABLE(id uuid, item_id uuid, slug text, kind text, title text, version integer, industry text,
  purpose text, summary text, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.item_id, m.slug, m.kind, m.title, m.version, m.industry, m.purpose,
    left(m.body, 600), m.published_at
  FROM public.valo_manual_library m
  WHERE m.kind IN ('template', 'premium_template') AND m.state = 'published'
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
  ORDER BY m.published_at DESC, m.id
$$;--> statement-breakpoint
-- A released free template's text, for a workspace's copy of it. A premium template's text is in its
-- file alone, so it has none here. Nothing for an unscoped session.
CREATE FUNCTION public.valo_free_library_edition(wanted uuid)
RETURNS TABLE(edition uuid, version integer, title text, body text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.title, m.body FROM public.valo_manual_library m
  WHERE m.id = wanted AND m.kind = 'template' AND m.state = 'published'
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
$$;--> statement-breakpoint
-- The staff-library release each of the scoped workspace's copied documents came from, whatever has
-- happened to it since: the business library names it beside the document's files (DOC-005).
CREATE FUNCTION public.valo_workspace_library_editions()
RETURNS TABLE(document uuid, edition uuid, slug text, title text, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT d.id, m.id, m.slug, m.title, m.version
  FROM public.valo_documents d JOIN public.valo_manual_library m ON m.id = d.library_edition
  WHERE d.workspace_id = (SELECT public.valo_scope_workspace())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_live_manual_templates(), public.valo_free_library_edition(uuid),
  public.valo_workspace_library_editions() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_live_manual_templates(), public.valo_free_library_edition(uuid),
  public.valo_workspace_library_editions() TO valo_workspace_scope;
