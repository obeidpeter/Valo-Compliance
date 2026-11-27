-- Run the entire edition backfill, trigger installation and privilege change as one database statement.
-- Both the CI migration runner and the native operator therefore hold the same locks until completion.
DO $valo_premium_migration$
BEGIN
CREATE TABLE "valo_commerce_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reviewed_version_id" uuid,
	"manual_version_id" uuid,
	CONSTRAINT "valo_commerce_exact_version" CHECK (num_nonnulls("valo_commerce_versions"."reviewed_version_id","valo_commerce_versions"."manual_version_id") = 1 AND "valo_commerce_versions"."id" = coalesce("valo_commerce_versions"."reviewed_version_id","valo_commerce_versions"."manual_version_id"))
);

ALTER TABLE "valo_manual_library" DROP CONSTRAINT "valo_manual_kind";
ALTER TABLE "valo_manual_library" DROP CONSTRAINT "valo_manual_file";
ALTER TABLE "valo_entitlements" DROP CONSTRAINT "valo_entitlements_content_version_id_valo_content_versions_id_fk";

ALTER TABLE "valo_prices" DROP CONSTRAINT "valo_prices_content_version_id_valo_content_versions_id_fk";

ALTER TABLE "valo_commerce_versions" ADD CONSTRAINT "valo_commerce_versions_reviewed_version_id_valo_content_versions_id_fk" FOREIGN KEY ("reviewed_version_id") REFERENCES "public"."valo_content_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "valo_commerce_versions" ADD CONSTRAINT "valo_commerce_versions_manual_version_id_valo_manual_library_id_fk" FOREIGN KEY ("manual_version_id") REFERENCES "public"."valo_manual_library"("id") ON DELETE cascade ON UPDATE no action;
-- Serialize the backfill with new editions. Prices, purchases and entitlements retain their original IDs.
LOCK TABLE public.valo_content_versions, public.valo_manual_library IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.valo_commerce_versions (id, reviewed_version_id)
SELECT id, id FROM public.valo_content_versions;
CREATE FUNCTION public.valo_register_commerce_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_RELID='public.valo_content_versions'::regclass THEN
    INSERT INTO public.valo_commerce_versions(id,reviewed_version_id) VALUES(NEW.id,NEW.id);
  ELSIF TG_RELID='public.valo_manual_library'::regclass AND NEW.kind='premium_template' THEN
    INSERT INTO public.valo_commerce_versions(id,manual_version_id) VALUES(NEW.id,NEW.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.valo_register_commerce_version() FROM PUBLIC;
CREATE TRIGGER valo_record_reviewed_commerce_version AFTER INSERT ON public.valo_content_versions
FOR EACH ROW EXECUTE FUNCTION public.valo_register_commerce_version();
CREATE TRIGGER valo_record_manual_commerce_version AFTER INSERT ON public.valo_manual_library
FOR EACH ROW WHEN (NEW.kind='premium_template') EXECUTE FUNCTION public.valo_register_commerce_version();
ALTER TABLE "valo_entitlements" ADD CONSTRAINT "valo_entitlements_content_version_id_valo_commerce_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."valo_commerce_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "valo_prices" ADD CONSTRAINT "valo_prices_content_version_id_valo_commerce_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."valo_commerce_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "valo_manual_library" ADD CONSTRAINT "valo_manual_premium_preview" CHECK ("valo_manual_library"."kind" <> 'premium_template' OR length("valo_manual_library"."body") <= 600);
ALTER TABLE "valo_manual_library" ADD CONSTRAINT "valo_manual_kind" CHECK ("valo_manual_library"."kind" IN ('practical_guide','industry_introduction','template','premium_template','regulatory_article'));
ALTER TABLE "valo_manual_library" ADD CONSTRAINT "valo_manual_file" CHECK (("valo_manual_library"."file_bytes" IS NULL AND "valo_manual_library"."file_format" IS NULL AND "valo_manual_library"."kind" NOT IN ('template','premium_template')) OR ("valo_manual_library"."file_bytes" IS NOT NULL AND "valo_manual_library"."kind" IN ('template','premium_template') AND "valo_manual_library"."file_format" IS NOT NULL AND "valo_manual_library"."file_format" IN ('pdf','docx') AND octet_length("valo_manual_library"."file_bytes") BETWEEN 1 AND 2097152));
-- Scoped customer code may read released edition IDs, never the private editorial table.
-- With an ID, admit checkout under the same row lock as withdrawal.
CREATE FUNCTION public.valo_live_manual_premium_versions(wanted uuid) RETURNS TABLE(edition uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF wanted IS NULL THEN
    RETURN QUERY SELECT m.id FROM public.valo_manual_library m
      WHERE m.kind='premium_template' AND m.state='published';
  ELSE
    RETURN QUERY SELECT m.id FROM public.valo_manual_library m
      WHERE m.id=wanted AND m.kind='premium_template' AND m.state='published' FOR SHARE OF m;
  END IF;
END $$;
CREATE FUNCTION public.valo_manual_purchased_file(wanted uuid)
RETURNS TABLE(slug text, version integer, format text, bytes bytea)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT m.slug, m.version, m.file_format, m.file_bytes
    FROM public.valo_manual_library m
    JOIN public.valo_entitlements e ON e.content_version_id=m.id AND e.workspace_id=(SELECT public.valo_scope_workspace())
    JOIN public.valo_orders o ON o.id=e.order_id AND o.workspace_id=e.workspace_id
    JOIN public.valo_prices p ON p.id=o.price_id AND p.content_version_id=m.id
    WHERE m.id=wanted AND m.kind='premium_template' AND m.state='published'
      AND e.status='active' AND o.status='verified_success' AND length(o.provider_transaction_id)>0
      AND o.line->>'contentVersionId'=m.id::text AND o.line->>'licenceVersion'=p.licence_version
      AND length(p.approval_reference)>0
    LIMIT 1 FOR SHARE OF m,e,o
$$;
REVOKE ALL ON FUNCTION public.valo_live_manual_premium_versions(uuid), public.valo_manual_purchased_file(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valo_live_manual_premium_versions(uuid), public.valo_manual_purchased_file(uuid) TO valo_workspace_scope;
END
$valo_premium_migration$;
