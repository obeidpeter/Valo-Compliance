-- A premium fill-in form (TPL-13 to TPL-17) may be started, or added to a document, only by a
-- workspace that holds a verified purchase of a live edition of its template (forms v2, slice 1).
-- The evidence is the one a premium file's download already requires (valo_manual_purchased_file):
-- an active entitlement, a verified order with its provider transaction, and the order's own edition
-- and licence under an approved price. A staff-library edition is the template's when its title is
-- the template's registered title, which the library already requires of a premium template; a
-- reviewed edition is the template's by its template_id. Customer code may not read the editorial
-- table, so it asks this function, which answers only for the scoped workspace and returns nothing
-- else.
CREATE FUNCTION public.valo_workspace_holds_template(wanted_template text, wanted_title text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
      JOIN public.valo_prices p ON p.id=o.price_id AND p.content_version_id=e.content_version_id
      JOIN public.valo_manual_library m ON m.id=e.content_version_id
     WHERE e.workspace_id=(SELECT public.valo_scope_workspace())
       AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
       AND o.line->>'contentVersionId'=e.content_version_id::text
       AND o.line->>'licenceVersion'=p.licence_version AND length(p.approval_reference)>0
       AND m.kind='premium_template' AND m.state='published' AND lower(m.title)=lower(wanted_title)
  ) OR EXISTS (
    SELECT 1
      FROM public.valo_entitlements e
      JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
      JOIN public.valo_prices p ON p.id=o.price_id AND p.content_version_id=e.content_version_id
      JOIN public.valo_content_versions v ON v.id=e.content_version_id
     WHERE e.workspace_id=(SELECT public.valo_scope_workspace())
       AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
       AND o.line->>'contentVersionId'=e.content_version_id::text
       AND o.line->>'licenceVersion'=p.licence_version AND length(p.approval_reference)>0
       AND v.template_id=wanted_template AND v.status='published'
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_workspace_holds_template(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_workspace_holds_template(text, text) TO valo_workspace_scope;
