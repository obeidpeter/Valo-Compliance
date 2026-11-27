-- docs/architecture/reviewed-route.md, part 1: on the reviewed route, a replaced version is never live
-- again. A version is replaced once a later version of the same template has been released, whether that
-- later version is still published or was withdrawn since (a version is withdrawn only after it was
-- published). The application closes a replaced version's file to new downloads and starts no new document
-- from it.
--
-- The premium forms ask this function whether the scoped workspace holds a template. On the reviewed route
-- it now counts only a version that is not replaced: a purchase carries to the template's latest release
-- under the rule its order recorded, and an order that covers only the version it bought holds nothing once
-- that version is replaced. The staff library's branch is unchanged, and so is everything else.
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
                     AND (v.id=b.id OR o.carries_to_later_editions IS NOT FALSE)
                     AND NOT EXISTS (SELECT 1 FROM public.valo_content_versions later
                                     WHERE later.template_id=v.template_id AND later.version>v.version
                                       AND later.status IN ('published','withdrawn')))
  )
$$;
