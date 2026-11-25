CREATE TABLE "valo_manual_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition" uuid NOT NULL,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "valo_manual_review_note" CHECK (char_length("valo_manual_reviews"."note") BETWEEN 20 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "valo_manual_reviews" ADD CONSTRAINT "valo_manual_review_edition_fk" FOREIGN KEY ("edition") REFERENCES "public"."valo_manual_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valo_manual_review_edition" ON "valo_manual_reviews" USING btree ("edition","reviewed_at");--> statement-breakpoint
-- A review is recorded once, of the published version of an entry other than a regulatory guide, by an
-- active Content editor, at the moment it is made, and never changed (docs/architecture/guidance-currency.md,
-- slice 2).
CREATE FUNCTION public.valo_guard_manual_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE entry public.valo_manual_library%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A review keeps what it recorded'; END IF;
  SELECT * INTO entry FROM public.valo_manual_library WHERE id = NEW.edition;
  IF NOT FOUND OR entry.state <> 'published' OR entry.kind = 'regulatory_article' THEN
    RAISE EXCEPTION 'Only the published version of a library entry other than a regulatory guide is reviewed here';
  END IF;
  IF NOT EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.reviewed_by AND role = 'content'
                 AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'An active content editor is required';
  END IF;
  NEW.reviewed_at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_manual_review() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_manual_review BEFORE INSERT OR UPDATE OR DELETE ON public.valo_manual_reviews
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_manual_review();--> statement-breakpoint
-- When a staff-library entry is next due for review: 90 days after it was published or last reviewed. A
-- regulatory guide's review is its source check and amendment records, so this is not read for one.
CREATE FUNCTION public.valo_manual_review_due(wanted uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT greatest(m.published_at,
      (SELECT max(r.reviewed_at) FROM public.valo_manual_reviews r WHERE r.edition = m.id))
    + interval '90 days'
  FROM public.valo_manual_library m WHERE m.id = wanted
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_manual_review_due(uuid) FROM PUBLIC;--> statement-breakpoint
-- An entry whose review is overdue is held from new use: it is not listed to save, copied into a new
-- document, started as a form or offered for sale. What a customer already has, and their purchased
-- files, are unchanged.
CREATE OR REPLACE FUNCTION public.valo_live_manual_templates()
RETURNS TABLE(id uuid, item_id uuid, slug text, kind text, title text, version integer, industry text,
  purpose text, summary text, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.item_id, m.slug, m.kind, m.title, m.version, m.industry, m.purpose,
    left(m.body, 600), m.published_at
  FROM public.valo_manual_library m
  WHERE m.kind IN ('template', 'premium_template') AND m.state = 'published'
    AND public.valo_manual_review_due(m.id) > clock_timestamp()
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
  ORDER BY m.published_at DESC, m.id
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_free_library_edition(wanted uuid)
RETURNS TABLE(edition uuid, version integer, title text, body text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.title, m.body FROM public.valo_manual_library m
  WHERE m.id = wanted AND m.kind = 'template' AND m.state = 'published'
    AND public.valo_manual_review_due(m.id) > clock_timestamp()
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_free_form_edition(wanted_title text)
RETURNS TABLE(edition uuid, version integer, form_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.form_text FROM public.valo_manual_library m
  WHERE m.kind = 'template' AND m.state = 'published' AND m.form_text IS NOT NULL
    AND lower(m.title) = lower(wanted_title)
    AND public.valo_manual_review_due(m.id) > clock_timestamp()
    AND (SELECT public.valo_scope_workspace()) IS NOT NULL
  ORDER BY m.published_at DESC, m.id
  LIMIT 1
$$;--> statement-breakpoint
-- A premium edition overdue for its review is neither offered nor ordered, while its buyers still
-- download it and find it among their purchases. So each published edition is listed with whether it
-- is held, and the offers, a new order and the price command leave out one that is.
DROP FUNCTION public.valo_live_manual_premium_versions(uuid);--> statement-breakpoint
CREATE FUNCTION public.valo_live_manual_premium_versions(wanted uuid) RETURNS TABLE(edition uuid, held boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF wanted IS NULL THEN
    RETURN QUERY SELECT m.id, public.valo_manual_review_due(m.id) <= clock_timestamp()
      FROM public.valo_manual_library m
      WHERE m.kind='premium_template' AND m.state='published';
  ELSE
    RETURN QUERY SELECT m.id, public.valo_manual_review_due(m.id) <= clock_timestamp()
      FROM public.valo_manual_library m
      WHERE m.id=wanted AND m.kind='premium_template' AND m.state='published' FOR SHARE OF m;
  END IF;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_live_manual_premium_versions(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_live_manual_premium_versions(uuid) TO valo_workspace_scope;
