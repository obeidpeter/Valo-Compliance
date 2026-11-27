-- A purchase carries to the next edition of the same template (docs/architecture/editions.md, slice 2;
-- delegated decision 3). A workspace with an active, verified purchase of any edition of a premium
-- template in the staff library may download the template's released edition, hold the template, and
-- start its form from it. The edition it bought closes to new downloads once replaced or withdrawn,
-- as before: each reader still reads only an edition that is released now. A refunded or reversed
-- purchase carries nothing. CREATE OR REPLACE keeps each function's owner and grants.
CREATE OR REPLACE FUNCTION public.valo_manual_purchased_file(wanted uuid)
RETURNS TABLE(slug text, version integer, format text, bytes bytea)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT m.slug, m.version, m.file_format, m.file_bytes
    FROM public.valo_manual_library m
    JOIN public.valo_manual_library b ON b.item_id=m.item_id AND b.kind='premium_template'
    JOIN public.valo_entitlements e ON e.content_version_id=b.id AND e.workspace_id=(SELECT public.valo_scope_workspace())
    JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
    JOIN public.valo_prices p ON p.id=o.price_id AND p.content_version_id=b.id
    WHERE m.id=wanted AND m.kind='premium_template' AND m.state='published'
      AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
      AND o.line->>'contentVersionId'=b.id::text AND o.line->>'licenceVersion'=p.licence_version
      AND length(p.approval_reference)>0
    LIMIT 1 FOR SHARE OF m,e,o
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_workspace_holds_template(wanted_template text, wanted_title text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
      JOIN public.valo_prices p ON p.id=o.price_id AND p.content_version_id=e.content_version_id
      JOIN public.valo_manual_library b ON b.id=e.content_version_id AND b.kind='premium_template'
      JOIN public.valo_manual_library m ON m.item_id=b.item_id AND m.kind='premium_template'
     WHERE e.workspace_id=(SELECT public.valo_scope_workspace())
       AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
       AND o.line->>'contentVersionId'=e.content_version_id::text
       AND o.line->>'licenceVersion'=p.licence_version AND length(p.approval_reference)>0
       AND m.state='published' AND lower(m.title)=lower(wanted_title)
  ) OR EXISTS (
    SELECT 1
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
      JOIN public.valo_prices p ON p.id=o.price_id AND p.content_version_id=e.content_version_id
      JOIN public.valo_content_versions b ON b.id=e.content_version_id
     WHERE e.workspace_id=(SELECT public.valo_scope_workspace())
       AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
       AND o.line->>'contentVersionId'=e.content_version_id::text
       AND o.line->>'licenceVersion'=p.licence_version AND length(p.approval_reference)>0
       AND b.template_id=wanted_template
       AND EXISTS (SELECT 1 FROM public.valo_content_versions v
                   WHERE v.template_id=b.template_id AND v.status='published')
  )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_premium_form_edition(wanted_title text)
RETURNS TABLE(edition uuid, version integer, form_text text, purchase uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.form_text, o.id
    FROM public.valo_manual_library m
    JOIN public.valo_manual_library b ON b.item_id = m.item_id AND b.kind = 'premium_template'
    JOIN public.valo_entitlements e ON e.content_version_id = b.id
     AND e.workspace_id = (SELECT public.valo_scope_workspace())
    JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
    JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = b.id
   WHERE m.kind = 'premium_template' AND m.state = 'published' AND m.form_text IS NOT NULL
     AND lower(m.title) = lower(wanted_title)
     AND e.status = 'active' AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
     AND o.line->>'contentVersionId' = b.id::text AND o.line->>'licenceVersion' = p.licence_version
     AND length(p.approval_reference) > 0
   ORDER BY m.published_at DESC, m.id, o.created_at, o.id
   LIMIT 1
$$;--> statement-breakpoint
-- A premium form document still records the order it was bought under, which may now be for an earlier
-- edition of the same template than the one whose wording it fills.
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
              JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = b.id
             WHERE e.workspace_id = NEW.workspace_id AND e.order_id = NEW.form_order
               AND e.status = 'active'
               AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
               AND o.line->>'contentVersionId' = b.id::text
               AND o.line->>'licenceVersion' = p.licence_version
               AND length(p.approval_reference) > 0)))) THEN
    RAISE EXCEPTION 'A form starts only from a released edition with its exact wording';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- The scoped workspace's purchases of a staff-library edition that was replaced, each with the
-- template's released edition the purchase now carries to, for the purchases screen and the template
-- page. Nothing for an unscoped session. Only the scoped role may call it.
CREATE FUNCTION public.valo_workspace_carried_editions()
RETURNS TABLE(bought uuid, bought_version integer, edition uuid, version integer, title text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT DISTINCT b.id, b.version, m.id, m.version, m.title
    FROM public.valo_entitlements e
    JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
    JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = e.content_version_id
    JOIN public.valo_manual_library b ON b.id = e.content_version_id AND b.kind = 'premium_template'
    JOIN public.valo_manual_library m ON m.item_id = b.item_id AND m.kind = 'premium_template'
     AND m.state = 'published' AND m.id <> b.id
   WHERE e.workspace_id = (SELECT public.valo_scope_workspace()) AND e.status = 'active'
     AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
     AND o.line->>'contentVersionId' = e.content_version_id::text
     AND o.line->>'licenceVersion' = p.licence_version AND length(p.approval_reference) > 0
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_workspace_carried_editions() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_workspace_carried_editions() TO valo_workspace_scope;
