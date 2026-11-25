CREATE TABLE "valo_manual_hold_lifts" (
	"hold" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"lifted_by" text NOT NULL,
	"lifted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_manual_hold_lift_reason" CHECK (char_length("valo_manual_hold_lifts"."reason") BETWEEN 20 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "valo_manual_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition" uuid NOT NULL,
	"reason" text NOT NULL,
	"placed_by" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspaces" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "valo_manual_hold_record" CHECK (char_length("valo_manual_holds"."reason") BETWEEN 20 AND 1000 AND "valo_manual_holds"."workspaces" >= 0)
);
--> statement-breakpoint
ALTER TABLE "valo_manual_hold_lifts" ADD CONSTRAINT "valo_manual_hold_lifts_hold_valo_manual_holds_id_fk" FOREIGN KEY ("hold") REFERENCES "public"."valo_manual_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_manual_holds" ADD CONSTRAINT "valo_manual_hold_edition_fk" FOREIGN KEY ("edition") REFERENCES "public"."valo_manual_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valo_manual_hold_edition" ON "valo_manual_holds" USING btree ("edition","placed_at");--> statement-breakpoint
-- A hold is placed on the published version of a library entry only, by an active Content editor, or by the
-- development owner for a regulatory guide, while the version has no open hold. The database dates it, counts
-- the workspaces its template reaches (slice 1) and never changes it (docs/architecture/library-holds.md,
-- slice 2). Like the library's own guard, it sets no search path: the owner check it calls reads its tables
-- through the session's.
CREATE FUNCTION public.valo_guard_manual_hold() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE entry public.valo_manual_library%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A hold keeps what it recorded'; END IF;
  SELECT * INTO entry FROM public.valo_manual_library WHERE id = NEW.edition;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the published version of a library entry is held'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(entry.item_id::text, 811));
  SELECT * INTO entry FROM public.valo_manual_library WHERE id = NEW.edition;
  IF entry.state <> 'published' THEN
    RAISE EXCEPTION 'Only the published version of a library entry is held';
  END IF;
  IF NOT (EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.placed_by AND role = 'content'
                  AND active AND (expires_at IS NULL OR expires_at > clock_timestamp()))
          OR (entry.kind = 'regulatory_article' AND public.valo_manual_regulatory_owner(NEW.placed_by))) THEN
    RAISE EXCEPTION 'An active content editor is required';
  END IF;
  IF public.valo_manual_edition_held(NEW.edition) THEN
    RAISE EXCEPTION 'This version is already held';
  END IF;
  NEW.placed_at := clock_timestamp();
  NEW.workspaces := (SELECT count(*) FROM public.valo_manual_edition_reach(NEW.edition));
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_manual_hold() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_manual_hold BEFORE INSERT OR UPDATE OR DELETE ON public.valo_manual_holds
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_manual_hold();--> statement-breakpoint
-- A hold is lifted once: on any entry but a regulatory guide by an active Content editor, and on a regulatory
-- guide only by the development owner, who alone releases one (decision 0018). The lifting is dated by the
-- database and never changed.
CREATE FUNCTION public.valo_guard_manual_hold_lift() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE entry public.valo_manual_library%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A lifted hold keeps what it recorded'; END IF;
  SELECT m.* INTO entry FROM public.valo_manual_library m
    JOIN public.valo_manual_holds h ON h.edition = m.id WHERE h.id = NEW.hold;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a hold that was placed is lifted'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(entry.item_id::text, 811));
  IF entry.kind = 'regulatory_article' THEN
    IF NOT public.valo_manual_regulatory_owner(NEW.lifted_by) THEN
      RAISE EXCEPTION 'Only the development owner lifts a regulatory guide''s hold';
    END IF;
  ELSIF NOT EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.lifted_by AND role = 'content'
                    AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'An active content editor is required';
  END IF;
  NEW.lifted_at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_manual_hold_lift() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_manual_hold_lift BEFORE INSERT OR UPDATE OR DELETE ON public.valo_manual_hold_lifts
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_manual_hold_lift();--> statement-breakpoint
-- Whether a library edition has a hold not yet lifted.
CREATE FUNCTION public.valo_manual_edition_held(target uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT FROM public.valo_manual_holds h WHERE h.edition = target
                 AND NOT EXISTS (SELECT FROM public.valo_manual_hold_lifts l WHERE l.hold = h.id))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_manual_edition_held(uuid) FROM PUBLIC;--> statement-breakpoint
-- A held version leaves new use as an overdue one does: it is not listed to save, copied into a new document,
-- started as a form or offered for sale. What a customer already has, and their purchased files, are
-- unchanged. Otherwise as the manual reviews migration left them.
CREATE OR REPLACE FUNCTION public.valo_live_manual_templates()
RETURNS TABLE(id uuid, item_id uuid, slug text, kind text, title text, version integer, industry text,
  purpose text, summary text, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.item_id, m.slug, m.kind, m.title, m.version, m.industry, m.purpose,
    left(m.body, 600), m.published_at
  FROM public.valo_manual_library m
  WHERE m.kind IN ('template', 'premium_template') AND m.state = 'published'
    AND public.valo_manual_review_due(m.id) > clock_timestamp()
    AND NOT public.valo_manual_edition_held(m.id)
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
  ORDER BY m.published_at DESC, m.id
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_free_library_edition(wanted uuid)
RETURNS TABLE(edition uuid, version integer, title text, body text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.title, m.body FROM public.valo_manual_library m
  WHERE m.id = wanted AND m.kind = 'template' AND m.state = 'published'
    AND public.valo_manual_review_due(m.id) > clock_timestamp()
    AND NOT public.valo_manual_edition_held(m.id)
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_free_form_edition(wanted_title text)
RETURNS TABLE(edition uuid, version integer, form_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.form_text FROM public.valo_manual_library m
  WHERE m.kind = 'template' AND m.state = 'published' AND m.form_text IS NOT NULL
    AND lower(m.title) = lower(wanted_title)
    AND public.valo_manual_review_due(m.id) > clock_timestamp()
    AND NOT public.valo_manual_edition_held(m.id)
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
  ORDER BY m.published_at DESC, m.id
  LIMIT 1
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_live_manual_premium_versions(wanted uuid) RETURNS TABLE(edition uuid, held boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF wanted IS NULL THEN
    RETURN QUERY SELECT m.id, public.valo_manual_review_due(m.id) <= clock_timestamp()
        OR public.valo_manual_edition_held(m.id)
      FROM public.valo_manual_library m
      WHERE m.kind='premium_template' AND m.state='published';
  ELSE
    RETURN QUERY SELECT m.id, public.valo_manual_review_due(m.id) <= clock_timestamp()
        OR public.valo_manual_edition_held(m.id)
      FROM public.valo_manual_library m
      WHERE m.id=wanted AND m.kind='premium_template' AND m.state='published' FOR SHARE OF m;
  END IF;
END $$;
