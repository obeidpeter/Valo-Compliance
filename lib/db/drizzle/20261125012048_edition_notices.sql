CREATE TABLE "valo_edition_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"route" text NOT NULL,
	"edition" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"version" integer NOT NULL,
	"replacement_version" integer,
	"reason" text,
	"held" boolean NOT NULL,
	"documents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "valo_edition_notice_shape" CHECK ("valo_edition_notices"."route" IN ('library', 'reviewed') AND "valo_edition_notices"."kind" IN ('replaced', 'withdrawn') AND "valo_edition_notices"."documents" >= 0 AND ("valo_edition_notices"."held" OR "valo_edition_notices"."documents" > 0) AND (("valo_edition_notices"."kind" = 'replaced') = ("valo_edition_notices"."replacement_version" IS NOT NULL)) AND ("valo_edition_notices"."reason" IS NULL OR "valo_edition_notices"."kind" = 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "valo_edition_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "valo_manual_withdrawals" (
	"edition" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_manual_withdrawal_reason" CHECK (char_length("valo_manual_withdrawals"."reason") BETWEEN 20 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "valo_edition_notices" ADD CONSTRAINT "valo_edition_notices_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_manual_withdrawals" ADD CONSTRAINT "valo_manual_withdrawals_edition_valo_manual_library_id_fk" FOREIGN KEY ("edition") REFERENCES "public"."valo_manual_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_edition_notice_once" ON "valo_edition_notices" USING btree ("workspace_id","edition","kind");--> statement-breakpoint
CREATE INDEX "valo_edition_notice_workspace" ON "valo_edition_notices" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_edition_notices" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_edition_notices"."workspace_id" = (select valo_scope_workspace())) WITH CHECK ("valo_edition_notices"."workspace_id" = (select valo_scope_workspace()));--> statement-breakpoint
-- A withdrawal's reason is written once, with the withdrawal, and never changed
-- (docs/architecture/editions.md, slice 3).
CREATE FUNCTION public.valo_guard_manual_withdrawal() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'A withdrawal keeps the reason it was given';
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_manual_withdrawal() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_manual_withdrawal BEFORE UPDATE OR DELETE ON public.valo_manual_withdrawals
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_manual_withdrawal();--> statement-breakpoint
-- When a staff-library template's edition is withdrawn, and when a new edition is released after one,
-- each workspace that holds the template, or made a document from that edition, gets one notice. The
-- database writes it in the transaction that makes the change, whoever makes it. It runs as the
-- table's owner, so that the session making the change needs no right to the workspaces' rows.
CREATE FUNCTION public.valo_note_library_edition() RETURNS trigger
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
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_note_library_edition() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_note_library_edition AFTER UPDATE OF state ON public.valo_manual_library
FOR EACH ROW EXECUTE FUNCTION public.valo_note_library_edition();--> statement-breakpoint
-- On the reviewed route, when a new version of a template is published, each workspace that holds the
-- template, or made a document from the version before it, gets one notice. Its withdrawals and holds
-- keep their correction notices. A version's title is read from its bundle where it can be, and is its
-- template's identifier otherwise, so that a notice never blocks a publication.
CREATE FUNCTION public.valo_note_reviewed_edition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous public.valo_content_versions%ROWTYPE;
DECLARE named text;
BEGIN
  IF NOT (NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published') THEN RETURN NULL; END IF;
  SELECT * INTO previous FROM public.valo_content_versions v
   WHERE v.template_id = NEW.template_id AND v.version < NEW.version AND v.published_at IS NOT NULL
   ORDER BY v.version DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  BEGIN
    named := ((previous.bundle->'candidate'->>'body')::jsonb)->>'title';
  EXCEPTION WHEN others THEN
    named := NULL;
  END;
  INSERT INTO public.valo_edition_notices(workspace_id, route, edition, kind, title, version,
    replacement_version, reason, held, documents)
  SELECT affected.workspace_id, 'reviewed', previous.id, 'replaced',
    coalesce(nullif(named, ''), previous.template_id), previous.version, NEW.version, NULL,
    bool_or(affected.held), sum(affected.documents)::integer
  FROM (
    SELECT e.workspace_id, true AS held, 0 AS documents
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
      JOIN public.valo_content_versions b ON b.id = e.content_version_id AND b.template_id = NEW.template_id
     WHERE e.status = 'active' AND o.status = 'verified_success'
    UNION ALL
    SELECT d.workspace_id, false, 1
      FROM public.valo_documents d
     WHERE d.template_version_id = previous.id
  ) affected
  GROUP BY affected.workspace_id
  ON CONFLICT (workspace_id, edition, kind) DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_note_reviewed_edition() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_note_reviewed_edition AFTER UPDATE OF status ON public.valo_content_versions
FOR EACH ROW EXECUTE FUNCTION public.valo_note_reviewed_edition();--> statement-breakpoint
-- A workspace reads its notices and marks them read, and changes nothing else of them.
GRANT SELECT, UPDATE(read_at) ON public.valo_edition_notices TO valo_workspace_scope;--> statement-breakpoint
-- Where a document's staff-library edition stands, now with the reason a withdrawal was given.
DROP FUNCTION public.valo_workspace_document_editions();--> statement-breakpoint
CREATE FUNCTION public.valo_workspace_document_editions()
RETURNS TABLE(document uuid, edition uuid, title text, version integer, latest_version integer,
  latest_slug text, latest_state text, latest_published_at timestamptz, latest_closed_at timestamptz,
  latest_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT d.id, m.id, m.title, m.version, l.version, l.slug, l.state, l.published_at, l.closed_at, w.reason
  FROM public.valo_documents d
  JOIN public.valo_manual_library m ON m.id = coalesce(d.library_edition, d.form_edition)
  JOIN LATERAL (
    SELECT x.id, x.version, x.slug, x.state, x.published_at, x.closed_at
    FROM public.valo_manual_library x
    WHERE x.item_id = m.item_id AND x.published_at IS NOT NULL
    ORDER BY x.version DESC
    LIMIT 1
  ) l ON true
  LEFT JOIN public.valo_manual_withdrawals w ON w.edition = l.id
  WHERE d.workspace_id = (SELECT public.valo_scope_workspace())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_workspace_document_editions() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_workspace_document_editions() TO valo_workspace_scope;
