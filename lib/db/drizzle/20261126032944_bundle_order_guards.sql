-- ADM-006 (docs/architecture/commercial-settings.md, slice 4c): buying a bundle. A bundle's order names the
-- bundle's version, copies its licence, and grants, for each of its templates, the released edition its line
-- names, each with an entitlement of its own (migration bundle_orders).
--
-- valo_order_terms_hold, the one check of a purchase's terms that every reader calls (slice 4a), learns a
-- bundle's order: it holds for an edition the order's line names, whose item is one of the bundle's, under
-- the bundle's licence and with the owner's approval. A template's order is checked as before.
CREATE OR REPLACE FUNCTION public.valo_order_terms_hold(wanted_order uuid, wanted_edition uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT FROM public.valo_orders o
      JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = wanted_edition
     WHERE o.id = wanted_order
       AND o.workspace_id = coalesce((SELECT public.valo_scope_workspace()), o.workspace_id)
       AND o.line->>'contentVersionId' = wanted_edition::text
       AND o.line->>'licenceVersion' = p.licence_version AND length(p.approval_reference) > 0
  ) OR EXISTS (
    SELECT FROM public.valo_orders o
      JOIN public.valo_bundles b ON b.id = o.bundle_id
      JOIN public.valo_manual_library m ON m.id = wanted_edition AND m.item_id = ANY (b.items)
     WHERE o.id = wanted_order
       AND o.workspace_id = coalesce((SELECT public.valo_scope_workspace()), o.workspace_id)
       AND o.line->'editions' @> jsonb_build_array(jsonb_build_object('contentVersionId', wanted_edition::text))
       AND o.line->>'licenceVersion' = b.licence_version AND length(b.approval_reference) > 0
  )
$$;--> statement-breakpoint
-- What a bundle's version holds now: each of its templates, by item, with its released edition and title, and
-- whether that edition is held or overdue for its review. A template with no released edition has none.
-- Checkout offers a bundle only while each of its templates has a released edition that is neither, and a
-- customer request may call it; like every function it may call, it runs as its owner.
CREATE FUNCTION public.valo_bundle_editions(wanted uuid)
RETURNS TABLE(item uuid, edition uuid, title text, held boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.item, m.id, m.title,
         CASE WHEN m.id IS NOT NULL THEN public.valo_manual_review_due(m.id) <= clock_timestamp()
           OR public.valo_manual_edition_held(m.id) END
    FROM public.valo_bundles b
   CROSS JOIN LATERAL unnest(b.items) AS i(item)
    LEFT JOIN public.valo_manual_library m
      ON m.item_id = i.item AND m.kind = 'premium_template' AND m.state = 'published'
   WHERE b.id = wanted
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_bundle_editions(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_bundle_editions(uuid) TO valo_workspace_scope;--> statement-breakpoint
-- Checkout reads the bundle's version in effect and holds it, as it holds a price, so the owner's next
-- version waits for the order or the order for it. The customer role may read and lock a version, and the
-- lock-only trigger refuses every change it attempts.
GRANT SELECT, UPDATE ON public.valo_bundles TO valo_workspace_scope;--> statement-breakpoint
CREATE TRIGGER valo_workspace_scope_lock_only BEFORE UPDATE ON public.valo_bundles
  FOR EACH ROW EXECUTE FUNCTION public.valo_refuse_scoped_update();
