-- ADM-006 (docs/architecture/commercial-settings.md, slice 3b): each order records the access rule in
-- effect when it was made, whether the purchase carries to its template's later editions, and keeps it.
-- The rule is the owner's setting purchase_carries_to_later_editions, which is yes until the owner records
-- another value. The inserting code gives the rule its buyer accepted, which must be the rule in effect;
-- an order given none records that rule. An order made before the rule had a record holds none, and
-- carries, as every purchase did when it was made.
--
-- The five readers that carry a purchase to a later edition read each order's own record: a purchase that
-- does not carry reaches only the edition it bought. So do the edition notices: a workspace holds an
-- edition when it bought it, or bought an earlier one under an order that carries, and a replacement's
-- notice records whether its purchase carries to the replacement. Each function is replaced as it stood,
-- with those conditions; CREATE OR REPLACE keeps its owner, its grants and its triggers.
CREATE FUNCTION public.valo_order_records_access_rule() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE rule boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    rule := coalesce((public.valo_commercial_setting('purchase_carries_to_later_editions'))::boolean, true);
    IF NEW.carries_to_later_editions IS NOT NULL AND NEW.carries_to_later_editions IS DISTINCT FROM rule THEN
      RAISE EXCEPTION 'An order records the access rule in effect when it is made' USING ERRCODE = '23514';
    END IF;
    NEW.carries_to_later_editions := rule;
  ELSIF NEW.carries_to_later_editions IS DISTINCT FROM OLD.carries_to_later_editions THEN
    RAISE EXCEPTION 'An order keeps the access rule it was bought under' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_order_records_access_rule() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_orders_record_access_rule BEFORE INSERT OR UPDATE ON public.valo_orders
  FOR EACH ROW EXECUTE FUNCTION public.valo_order_records_access_rule();--> statement-breakpoint
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
      JOIN public.valo_prices p ON p.id=o.price_id AND p.content_version_id=e.content_version_id
      JOIN public.valo_manual_library b ON b.id=e.content_version_id AND b.kind='premium_template'
      JOIN public.valo_manual_library m ON m.item_id=b.item_id AND m.kind='premium_template'
     WHERE e.workspace_id=(SELECT public.valo_scope_workspace())
       AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
       AND o.line->>'contentVersionId'=e.content_version_id::text
       AND o.line->>'licenceVersion'=p.licence_version AND length(p.approval_reference)>0
       AND m.state='published' AND lower(m.title)=lower(wanted_title)
       AND (m.id=b.id OR o.carries_to_later_editions IS NOT FALSE)
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
    JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = b.id
   WHERE m.kind = 'premium_template' AND m.state = 'published' AND m.form_text IS NOT NULL
     AND lower(m.title) = lower(wanted_title)
     AND e.status = 'active' AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
     AND o.line->>'contentVersionId' = b.id::text AND o.line->>'licenceVersion' = p.licence_version
     AND length(p.approval_reference) > 0
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
              JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = b.id
             WHERE e.workspace_id = NEW.workspace_id AND e.order_id = NEW.form_order
               AND e.status = 'active'
               AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
               AND o.line->>'contentVersionId' = b.id::text
               AND o.line->>'licenceVersion' = p.licence_version
               AND length(p.approval_reference) > 0
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
    JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = e.content_version_id
    JOIN public.valo_manual_library b ON b.id = e.content_version_id AND b.kind = 'premium_template'
    JOIN public.valo_manual_library m ON m.item_id = b.item_id AND m.kind = 'premium_template'
     AND m.state = 'published' AND m.id <> b.id
   WHERE e.workspace_id = (SELECT public.valo_scope_workspace()) AND e.status = 'active'
     AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
     AND o.line->>'contentVersionId' = e.content_version_id::text
     AND o.line->>'licenceVersion' = p.licence_version AND length(p.approval_reference) > 0
     AND o.carries_to_later_editions IS NOT FALSE
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_manual_edition_reach(target uuid)
RETURNS TABLE(workspace_id uuid, held boolean, documents integer)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT affected.workspace_id, bool_or(affected.held), sum(affected.documents)::integer
  FROM (
    SELECT e.workspace_id, true AS held, 0 AS documents
      FROM public.valo_manual_library edition
      JOIN public.valo_manual_library b ON b.item_id = edition.item_id
      JOIN public.valo_entitlements e ON e.content_version_id = b.id
      JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
     WHERE edition.id = target AND e.status = 'active' AND o.status = 'verified_success'
       AND (b.id = edition.id OR o.carries_to_later_editions IS NOT FALSE)
    UNION ALL
    SELECT d.workspace_id, false, 1
      FROM public.valo_documents d
     WHERE d.library_edition = target OR d.form_edition = target
  ) affected
  GROUP BY affected.workspace_id
$$;--> statement-breakpoint
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
    replacement_version, reason, held, carries, documents)
  SELECT reach.workspace_id, 'library', target.id, change, target.title, target.version,
    replacement, why, reach.held,
    CASE WHEN change = 'replaced' AND reach.held THEN EXISTS (
      SELECT FROM public.valo_entitlements e
        JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
        JOIN public.valo_manual_library b ON b.id = e.content_version_id AND b.item_id = target.item_id
       WHERE e.workspace_id = reach.workspace_id AND e.status = 'active' AND o.status = 'verified_success'
         AND o.carries_to_later_editions IS NOT FALSE) END,
    reach.documents
  FROM public.valo_manual_edition_reach(target.id) reach
  ON CONFLICT (workspace_id, edition, kind) DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valo_note_reviewed_edition() RETURNS trigger
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
    replacement_version, reason, held, carries, documents)
  SELECT affected.workspace_id, 'reviewed', previous.id, 'replaced',
    coalesce(nullif(named, ''), previous.template_id), previous.version, NEW.version, NULL,
    bool_or(affected.held), CASE WHEN bool_or(affected.held) THEN bool_or(affected.carries) END,
    sum(affected.documents)::integer
  FROM (
    SELECT e.workspace_id, true AS held, o.carries_to_later_editions IS NOT FALSE AS carries, 0 AS documents
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
      JOIN public.valo_content_versions b ON b.id = e.content_version_id AND b.template_id = NEW.template_id
     WHERE e.status = 'active' AND o.status = 'verified_success'
       AND (b.id = previous.id OR o.carries_to_later_editions IS NOT FALSE)
    UNION ALL
    SELECT d.workspace_id, false, false, 1
      FROM public.valo_documents d
     WHERE d.template_version_id = previous.id
  ) affected
  GROUP BY affected.workspace_id
  ON CONFLICT (workspace_id, edition, kind) DO NOTHING;
  RETURN NULL;
END $$;
