ALTER TABLE "valo_documents" ADD COLUMN "form_version" smallint;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD COLUMN "form_edition" uuid;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD COLUMN "form_digest" text;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD CONSTRAINT "valo_documents_form_edition_valo_manual_library_id_fk" FOREIGN KEY ("form_edition") REFERENCES "public"."valo_manual_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD CONSTRAINT "valo_document_form" CHECK (("valo_documents"."form_edition" IS NULL) = ("valo_documents"."form_digest" IS NULL) AND ("valo_documents"."form_edition" IS NULL) = ("valo_documents"."form_version" IS NULL) AND ("valo_documents"."form_version" IS NULL OR "valo_documents"."form_version" = 2) AND ("valo_documents"."form_digest" IS NULL OR "valo_documents"."form_digest" ~ '^[0-9a-f]{64}$'));;--> statement-breakpoint
-- A document's form record (forms v2): written once, from a released edition with its exact wording,
-- and never changed. The scoped role cannot read the editorial table, so the check runs as the owner.
CREATE FUNCTION public.valo_guard_document_form() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.form_version, NEW.form_edition, NEW.form_digest)
       IS DISTINCT FROM ROW(OLD.form_version, OLD.form_edition, OLD.form_digest) THEN
      RAISE EXCEPTION 'A document keeps the form it was started with';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.form_edition IS NOT NULL AND NOT EXISTS (
      SELECT FROM public.valo_manual_library m
      WHERE m.id = NEW.form_edition AND m.kind = 'template' AND m.state = 'published'
        AND m.form_text IS NOT NULL
        AND encode(sha256(convert_to(m.form_text, 'UTF8')), 'hex') = NEW.form_digest) THEN
    RAISE EXCEPTION 'A form starts only from a released edition with its exact wording';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_document_form() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_document_form BEFORE INSERT OR UPDATE ON public.valo_documents
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_document_form();--> statement-breakpoint
-- The released free edition a workspace may start a template's form from, by the template's
-- registered title: the most recently released one with form text. Nothing for an unscoped session.
CREATE FUNCTION public.valo_free_form_edition(wanted_title text)
RETURNS TABLE(edition uuid, version integer, form_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.form_text FROM public.valo_manual_library m
  WHERE m.kind = 'template' AND m.state = 'published' AND m.form_text IS NOT NULL
    AND lower(m.title) = lower(wanted_title)
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
  ORDER BY m.published_at DESC, m.id
  LIMIT 1
$$;--> statement-breakpoint
-- The edition one of the scoped workspace's documents was started with, and its form text, whatever
-- has happened to the edition since: a document made stays its owner's.
CREATE FUNCTION public.valo_document_form_text(wanted_document uuid)
RETURNS TABLE(edition uuid, version integer, title text, form_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.title, m.form_text
  FROM public.valo_documents d JOIN public.valo_manual_library m ON m.id = d.form_edition
  WHERE d.id = wanted_document AND d.workspace_id = (SELECT public.valo_scope_workspace())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_free_form_edition(text), public.valo_document_form_text(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_free_form_edition(text), public.valo_document_form_text(uuid) TO valo_workspace_scope;
