CREATE TABLE "valo_manual_changes" (
	"edition" uuid PRIMARY KEY NOT NULL,
	"note" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_manual_change_note" CHECK (char_length("valo_manual_changes"."note") BETWEEN 20 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "valo_edition_notices" DROP CONSTRAINT "valo_edition_notice_shape";--> statement-breakpoint
ALTER TABLE "valo_manual_changes" ADD CONSTRAINT "valo_manual_changes_edition_valo_manual_library_id_fk" FOREIGN KEY ("edition") REFERENCES "public"."valo_manual_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_edition_notices" ADD CONSTRAINT "valo_edition_notice_shape" CHECK ("valo_edition_notices"."route" IN ('library', 'reviewed') AND "valo_edition_notices"."kind" IN ('replaced', 'withdrawn') AND "valo_edition_notices"."documents" >= 0 AND ("valo_edition_notices"."held" OR "valo_edition_notices"."documents" > 0) AND (("valo_edition_notices"."kind" = 'replaced') = ("valo_edition_notices"."replacement_version" IS NOT NULL)) AND ("valo_edition_notices"."reason" IS NULL OR "valo_edition_notices"."kind" = 'withdrawn' OR "valo_edition_notices"."route" = 'library'));--> statement-breakpoint
-- The notices' shape now lets a library notice of a replacement carry the new version's change note, as
-- a withdrawal's notice carries its reason (docs/architecture/guidance-currency.md, slice 3). A notice on
-- the reviewed route still carries a reason only for a withdrawal.
-- What changed in a version that follows an earlier release of its entry is written once, before the
-- version is released in the same transaction, and never changed (docs/architecture/guidance-currency.md,
-- slice 3). It is written only for a draft that follows an earlier release.
CREATE FUNCTION public.valo_guard_manual_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE entry public.valo_manual_library%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A change note keeps what it said'; END IF;
  SELECT * INTO entry FROM public.valo_manual_library WHERE id = NEW.edition;
  IF NOT FOUND OR entry.state <> 'draft' OR NOT EXISTS (
       SELECT FROM public.valo_manual_library m
        WHERE m.item_id = entry.item_id AND m.version < entry.version AND m.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A change note is written for a draft that follows an earlier release';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_manual_change() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_manual_change BEFORE INSERT OR UPDATE OR DELETE ON public.valo_manual_changes
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_manual_change();--> statement-breakpoint
-- A version that follows an earlier release of its entry is released only with its change note, whoever
-- releases it: a Content editor in the staff library, or the owner signing a regulatory guide (CMP-005).
CREATE FUNCTION public.valo_require_manual_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.state = 'draft' AND NEW.state = 'published'
     AND EXISTS (SELECT FROM public.valo_manual_library m
                  WHERE m.item_id = NEW.item_id AND m.version < NEW.version AND m.published_at IS NOT NULL)
     AND NOT EXISTS (SELECT FROM public.valo_manual_changes c WHERE c.edition = NEW.id) THEN
    RAISE EXCEPTION 'Say what changed in this version before it is released after an earlier one';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_require_manual_change() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_require_manual_change BEFORE UPDATE OF state ON public.valo_manual_library
FOR EACH ROW EXECUTE FUNCTION public.valo_require_manual_change();--> statement-breakpoint
-- The notice that a template's edition was replaced carries the new version's change note, as a
-- withdrawal's notice carries its reason. Otherwise as in 20261125012048_edition_notices.
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
  SELECT affected.workspace_id, 'library', target.id, change, target.title, target.version,
    replacement, why, bool_or(affected.held), sum(affected.documents)::integer
  FROM (
    SELECT e.workspace_id, true AS held, 0 AS documents
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
      JOIN public.valo_manual_library b ON b.id = e.content_version_id AND b.item_id = target.item_id
     WHERE e.status = 'active' AND o.status = 'verified_success'
    UNION ALL
    SELECT d.workspace_id, false, 1
      FROM public.valo_documents d
     WHERE d.library_edition = target.id OR d.form_edition = target.id
  ) affected
  GROUP BY affected.workspace_id
  ON CONFLICT (workspace_id, edition, kind) DO NOTHING;
  RETURN NULL;
END $$;
