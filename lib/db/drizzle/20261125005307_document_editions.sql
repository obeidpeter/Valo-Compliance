-- Where the staff-library edition behind each of the scoped workspace's documents stands now
-- (docs/architecture/editions.md, slice 1): the edition a copy or a form document was made from, and
-- the latest edition of the same template that was ever released, with its state. A customer request
-- cannot read the editorial table, so this runs as its owner, and returns nothing outside a
-- workspace's scope.
CREATE FUNCTION public.valo_workspace_document_editions()
RETURNS TABLE(document uuid, edition uuid, title text, version integer, latest_version integer,
  latest_slug text, latest_state text, latest_published_at timestamptz, latest_closed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT d.id, m.id, m.title, m.version, l.version, l.slug, l.state, l.published_at, l.closed_at
  FROM public.valo_documents d
  JOIN public.valo_manual_library m ON m.id = coalesce(d.library_edition, d.form_edition)
  JOIN LATERAL (
    SELECT x.version, x.slug, x.state, x.published_at, x.closed_at
    FROM public.valo_manual_library x
    WHERE x.item_id = m.item_id AND x.published_at IS NOT NULL
    ORDER BY x.version DESC
    LIMIT 1
  ) l ON true
  WHERE d.workspace_id = (SELECT public.valo_scope_workspace())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_workspace_document_editions() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_workspace_document_editions() TO valo_workspace_scope;
