ALTER TABLE "valo_documents" ADD COLUMN "form_order" uuid;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD CONSTRAINT "valo_document_form_order_tenant_fk" FOREIGN KEY ("workspace_id","form_order") REFERENCES "public"."valo_orders"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD CONSTRAINT "valo_document_form_order" CHECK ("valo_documents"."form_order" IS NULL OR "valo_documents"."form_edition" IS NOT NULL);--> statement-breakpoint
-- A premium form (forms v2, slice 6) starts only from an edition the workspace bought, under its own
-- verified order of that edition, with the evidence a purchased file's download requires
-- (valo_manual_purchased_file); a free form records no order. The form record, the order with it, is
-- written once and never changed. The scoped role cannot read the editorial or payment evidence, so
-- the check runs as the owner.
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
              JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
              JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = m.id
             WHERE e.workspace_id = NEW.workspace_id AND e.order_id = NEW.form_order
               AND e.content_version_id = m.id AND e.status = 'active'
               AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
               AND o.line->>'contentVersionId' = m.id::text
               AND o.line->>'licenceVersion' = p.licence_version
               AND length(p.approval_reference) > 0)))) THEN
    RAISE EXCEPTION 'A form starts only from a released edition with its exact wording';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
-- The premium edition the scoped workspace may start a template's form from, by the template's
-- registered title: a released edition with form text that the workspace bought, with the evidence a
-- purchased file's download requires, and the order it was bought under. The most recently released
-- such edition, under its earliest such order. Nothing for another workspace or an unscoped session.
CREATE FUNCTION public.valo_premium_form_edition(wanted_title text)
RETURNS TABLE(edition uuid, version integer, form_text text, purchase uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.version, m.form_text, o.id
    FROM public.valo_manual_library m
    JOIN public.valo_entitlements e ON e.content_version_id = m.id
     AND e.workspace_id = (SELECT public.valo_scope_workspace())
    JOIN public.valo_orders o ON o.id = e.order_id AND o.workspace_id = e.workspace_id
    JOIN public.valo_prices p ON p.id = o.price_id AND p.content_version_id = m.id
   WHERE m.kind = 'premium_template' AND m.state = 'published' AND m.form_text IS NOT NULL
     AND lower(m.title) = lower(wanted_title)
     AND e.status = 'active' AND o.status = 'verified_success' AND length(o.provider_transaction_id) > 0
     AND o.line->>'contentVersionId' = m.id::text AND o.line->>'licenceVersion' = p.licence_version
     AND length(p.approval_reference) > 0
   ORDER BY m.published_at DESC, m.id, o.created_at, o.id
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_premium_form_edition(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_premium_form_edition(text) TO valo_workspace_scope;
