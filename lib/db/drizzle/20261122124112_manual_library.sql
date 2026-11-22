CREATE TABLE "valo_manual_library" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"industry" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"digest" text NOT NULL,
	"file_format" text,
	"file_bytes" "bytea",
	"state" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "valo_manual_kind" CHECK ("valo_manual_library"."kind" IN ('practical_guide','industry_introduction','template','regulatory_article')),
	CONSTRAINT "valo_manual_state" CHECK ("valo_manual_library"."state" IN ('draft','published','replaced','withdrawn') AND ("valo_manual_library"."kind" <> 'regulatory_article' OR "valo_manual_library"."state" = 'draft')),
	CONSTRAINT "valo_manual_identity" CHECK ("valo_manual_library"."version" > 0 AND "valo_manual_library"."digest" ~ '^[0-9a-f]{64}$' AND "valo_manual_library"."slug" = 'manual-' || "valo_manual_library"."item_id"::text),
	CONSTRAINT "valo_manual_text" CHECK (length("valo_manual_library"."title") BETWEEN 1 AND 140 AND length("valo_manual_library"."body") BETWEEN 1 AND 60000 AND ("valo_manual_library"."kind" <> 'industry_introduction' OR "valo_manual_library"."industry" IS NOT NULL)),
	CONSTRAINT "valo_manual_file" CHECK (("valo_manual_library"."file_bytes" IS NULL AND "valo_manual_library"."file_format" IS NULL AND "valo_manual_library"."kind" <> 'template') OR ("valo_manual_library"."file_bytes" IS NOT NULL AND "valo_manual_library"."kind" = 'template' AND "valo_manual_library"."file_format" IS NOT NULL AND "valo_manual_library"."file_format" IN ('pdf','docx') AND octet_length("valo_manual_library"."file_bytes") BETWEEN 1 AND 2097152)),
	CONSTRAINT "valo_manual_actors" CHECK (("valo_manual_library"."state" = 'draft') = ("valo_manual_library"."published_by" IS NULL) AND ("valo_manual_library"."published_by" IS NULL) = ("valo_manual_library"."published_at" IS NULL) AND ("valo_manual_library"."state" IN ('replaced','withdrawn')) = ("valo_manual_library"."closed_by" IS NOT NULL) AND ("valo_manual_library"."closed_by" IS NULL) = ("valo_manual_library"."closed_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "valo_manual_item_version" ON "valo_manual_library" USING btree ("item_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_manual_one_release" ON "valo_manual_library" USING btree ("item_id") WHERE "valo_manual_library"."state" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "valo_manual_one_intro" ON "valo_manual_library" USING btree ("industry") WHERE "valo_manual_library"."state" = 'published' AND "valo_manual_library"."kind" = 'industry_introduction';--> statement-breakpoint
CREATE INDEX "valo_manual_state_slug" ON "valo_manual_library" USING btree ("state","slug");
--> statement-breakpoint
CREATE FUNCTION valo_guard_manual_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest valo_manual_library%ROWTYPE;
DECLARE actor text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Editorial history is immutable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.item_id::text, 811));
  SELECT * INTO latest FROM valo_manual_library WHERE item_id = NEW.item_id ORDER BY version DESC LIMIT 1;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.version <> COALESCE(latest.version, 0) + 1
       OR (latest.id IS NOT NULL AND latest.kind <> NEW.kind) THEN
      RAISE EXCEPTION 'Save a new draft of the same content type';
    END IF;
    actor := NEW.created_by;
  ELSE
    IF ROW(NEW.id, NEW.item_id, NEW.version, NEW.slug, NEW.kind, NEW.industry, NEW.title, NEW.body,
           NEW.digest, NEW.file_format, NEW.file_bytes, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.item_id, OLD.version, OLD.slug, OLD.kind, OLD.industry, OLD.title, OLD.body,
           OLD.digest, OLD.file_format, OLD.file_bytes, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'Save corrections as a new revision';
    END IF;
    IF OLD.state = 'draft' AND NEW.state = 'published' AND latest.id = NEW.id AND NEW.kind <> 'regulatory_article' THEN
      actor := NEW.published_by;
    ELSIF OLD.state = 'published' AND NEW.state IN ('withdrawn','replaced') AND
          ROW(NEW.published_at, NEW.published_by) IS NOT DISTINCT FROM ROW(OLD.published_at, OLD.published_by) THEN
      actor := NEW.closed_by;
    ELSE
      RAISE EXCEPTION 'Invalid editorial transition';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT FROM valo_staff_assignments WHERE identity_id = actor AND role = 'content'
                 AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'An active content editor is required';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER valo_manual_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON valo_manual_library
FOR EACH ROW EXECUTE FUNCTION valo_guard_manual_revision();
--> statement-breakpoint
CREATE FUNCTION valo_hold_new_regulatory_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.bundle #>> '{candidate,contentClass}' = 'sourced_guidance' THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Owner source check required for regulatory articles'; END IF;
    IF OLD.status <> 'published' THEN RAISE EXCEPTION 'Owner source check required for regulatory articles'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER valo_hold_regulatory_article BEFORE INSERT OR UPDATE ON valo_content_versions
FOR EACH ROW EXECUTE FUNCTION valo_hold_new_regulatory_release();
