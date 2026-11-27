-- ADM-006 (docs/architecture/commercial-settings.md, slice 4a): one check of a purchase's terms, which moves
-- code and changes no behaviour. Five readers each repeated it: the order's price names the edition, the
-- order's line copies the edition and the price's licence, and the price carries the owner's approval.
-- valo_order_terms_hold makes that check once, and each reader calls it in place of its own copy; each is
-- replaced as it stood otherwise. Checkout's list of verified editions calls it too, so a customer request
-- may call it: like every function it may call, it runs as its owner, and in a customer request's scope it
-- reads only that workspace's orders; outside one, the scope's workspace is none and it reads any order.
CREATE FUNCTION public.valo_order_terms_hold(wanted_order uuid, wanted_edition uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT FROM public.valo_orders o
      JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = wanted_edition
     WHERE o.id = wanted_order
       AND o.workspace_id = coalesce((SELECT public.valo_scope_workspace()), o.workspace_id)
       AND o.line->>'contentVersionId' = wanted_edition::text
       AND o.line->>'licenceVersion' = p.licence_version AND length(p.approval_reference) > 0
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_order_terms_hold(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_order_terms_hold(uuid, uuid) TO valo_workspace_scope;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_manual_purchased_file(wanted uuid)
RETURNS TABLE(slug text, version integer, format text, bytes bytea)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT m.slug, m.version, m.file_format, m.file_bytes
    FROM public.valo_manual_library m
    JOIN public.valo_manual_library b ON b.item_id=m.item_id AND b.kind='premium_template'
    JOIN public.valo_entitlements e ON e.content_version_id=b.id AND e.workspace_id=(SELECT public.valo_scope_workspace())
    JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
    WHERE m.id=wanted AND m.kind='premium_template' AND m.state='published'
      AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
      AND public.valo_order_terms_hold(o.id, b.id)
      AND (m.id=b.id OR o.carries_to_later_editions IS NOT FALSE)
    LIMIT 1 FOR SHARE OF m,e,o
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_workspace_holds_template(wanted_template text, wanted_title text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
      JOIN public.valo_manual_library b ON b.id=e.content_version_id AND b.kind='premium_template'
      JOIN public.valo_manual_library m ON m.item_id=b.item_id AND m.kind='premium_template'
     WHERE e.workspace_id=(SELECT public.valo_scope_workspace())
       AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
       AND public.valo_order_terms_hold(o.id, e.content_version_id)
       AND m.state='published' AND lower(m.title)=lower(wanted_title)
       AND (m.id=b.id OR o.carries_to_later_editions IS NOT FALSE)
  ) OR EXISTS (
    SELECT 1
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
      JOIN public.valo_content_versions b ON b.id=e.content_version_id
     WHERE e.workspace_id=(SELECT public.valo_scope_workspace())
       AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
       AND public.valo_order_terms_hold(o.id, e.content_version_id)
       AND b.template_id=wanted_template
       AND EXISTS (SELECT 1 FROM public.valo_content_versions v
                   WHERE v.template_id=b.template_id AND v.status='published'
                     AND (v.id=b.id OR o.carries_to_later_editions IS NOT FALSE))
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_premium_form_edition(wanted_title text)
RETURNS TABLE(edition uuid, version integer, form_text text, purchase uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.form_text, o.id
    FROM public.valo_manual_library m
    JOIN public.valo_manual_library b ON b.item_id = m.item_id AND b.kind = 'premium_template'
    JOIN public.valo_entitlements e ON e.content_version_id = b.id
     AND e.workspace_id = (SELECT public.valo_scope_workspace())
    JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
   WHERE m.kind = 'premium_template' AND m.state = 'published' AND m.form_text IS NOT NULL
     AND lower(m.title) = lower(wanted_title)
     AND e.status = 'active' AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
     AND public.valo_order_terms_hold(o.id, b.id)
     AND (m.id = b.id OR o.carries_to_later_editions IS NOT FALSE)
   ORDER BY m.published_at DESC, m.id, o.created_at, o.id
   LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_guard_document_form() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.form_version, NEW.form_edition, NEW.form_digest, NEW.form_order)
       IS DISTINCT FROM ROW(OLD.form_version, OLD.form_edition, OLD.form_digest, OLD.form_order) THEN
      RAISE EXCEPTION 'A document keeps the form it was started with';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.form_edition IS NOT NULL AND NOT EXISTS (
      SELECT FROM public.valo_manual_library m
      WHERE m.id = NEW.form_edition AND m.state = 'published' AND m.form_text IS NOT NULL
        AND encode(sha256(convert_to(m.form_text, 'UTF8')), 'hex') = NEW.form_digest
        AND ((m.kind = 'template' AND NEW.form_order IS NULL)
          OR (m.kind = 'premium_template' AND EXISTS (
            SELECT FROM public.valo_entitlements e
              JOIN public.valo_manual_library b ON b.id = e.content_version_id
               AND b.item_id = m.item_id AND b.kind = 'premium_template'
              JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
             WHERE e.workspace_id = NEW.workspace_id AND e.order_id = NEW.form_order
               AND e.status = 'active'
               AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
               AND public.valo_order_terms_hold(o.id, b.id)
               AND (b.id = m.id OR o.carries_to_later_editions IS NOT FALSE))))) THEN
    RAISE EXCEPTION 'A form starts only from a released edition with its exact wording';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_workspace_carried_editions()
RETURNS TABLE(bought uuid, bought_version integer, edition uuid, version integer, title text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT DISTINCT b.id, b.version, m.id, m.version, m.title
    FROM public.valo_entitlements e
    JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
    JOIN public.valo_manual_library b ON b.id = e.content_version_id AND b.kind = 'premium_template'
    JOIN public.valo_manual_library m ON m.item_id = b.item_id AND m.kind = 'premium_template'
     AND m.state = 'published' AND m.id <> b.id
   WHERE e.workspace_id = (SELECT public.valo_scope_workspace()) AND e.status = 'active'
     AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
     AND public.valo_order_terms_hold(o.id, e.content_version_id)
     AND o.carries_to_later_editions IS NOT FALSE
$$;
