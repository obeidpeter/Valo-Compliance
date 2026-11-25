CREATE TABLE "valo_source_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"authority" text,
	"jurisdiction" text NOT NULL,
	"instrument" text,
	"version_in_force" text,
	"effective_from" date,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_source_register_version" UNIQUE("source_id","version"),
	CONSTRAINT "valo_source_register_fields" CHECK ("valo_source_register"."version" >= 1 AND length("valo_source_register"."source_id") BETWEEN 1 AND 100 AND length("valo_source_register"."title") BETWEEN 1 AND 300 AND "valo_source_register"."url" ~ '^https://' AND length("valo_source_register"."jurisdiction") BETWEEN 1 AND 60 AND ("valo_source_register"."authority" IS NULL OR length("valo_source_register"."authority") BETWEEN 1 AND 200) AND ("valo_source_register"."instrument" IS NULL OR "valo_source_register"."instrument" IN ('act','regulatory_document','official_page')) AND ("valo_source_register"."version_in_force" IS NULL OR length("valo_source_register"."version_in_force") BETWEEN 1 AND 200) AND ("valo_source_register"."instrument" IS DISTINCT FROM 'official_page' OR "valo_source_register"."effective_from" IS NULL) AND "valo_source_register"."status" IN ('active','retired') AND length("valo_source_register"."reason") BETWEEN 20 AND 1000)
);--> statement-breakpoint
-- The source register (docs/architecture/source-register.md, slice 1, ADM-003) keeps each entry as versions.
-- A version is recorded by an active Content editor, as the next version of its entry, at the address its
-- entry was first recorded at; the database dates it and never changes or removes it. A correction, a
-- retirement and a return are each a new version with why.
CREATE FUNCTION public.valo_guard_source_register() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE previous public.valo_source_register%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A source register version is never changed or removed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.source_id, 813));
  SELECT * INTO previous FROM public.valo_source_register WHERE source_id = NEW.source_id
    ORDER BY version DESC LIMIT 1;
  IF NEW.version <> COALESCE(previous.version, 0) + 1 THEN
    RAISE EXCEPTION 'Record the next version of the latest source register entry';
  END IF;
  IF previous.id IS NOT NULL AND NEW.url <> previous.url THEN
    RAISE EXCEPTION 'A source register entry keeps its address';
  END IF;
  IF NOT EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.created_by AND role = 'content'
                 AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'An active content editor is required';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_source_register() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_source_register BEFORE INSERT OR UPDATE OR DELETE ON public.valo_source_register
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_source_register();
