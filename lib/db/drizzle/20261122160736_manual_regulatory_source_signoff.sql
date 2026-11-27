CREATE TABLE "valo_manual_regulatory_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" text NOT NULL,
	"title" text NOT NULL,
	"body_sha256" text NOT NULL,
	"evidence_sha256" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"sources" jsonb NOT NULL,
	"holds" text[] NOT NULL,
	CONSTRAINT "valo_manual_regulatory_candidate" CHECK ("valo_manual_regulatory_checks"."candidate_id" ~ '^GUD-(0[1-9]|[12][0-9]|30)$' AND length("valo_manual_regulatory_checks"."title") BETWEEN 1 AND 140),
	CONSTRAINT "valo_manual_regulatory_hashes" CHECK ("valo_manual_regulatory_checks"."body_sha256" ~ '^[a-f0-9]{64}$' AND "valo_manual_regulatory_checks"."evidence_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "valo_manual_regulatory_references" CHECK (jsonb_typeof("valo_manual_regulatory_checks"."sources") = 'array' AND (cardinality("valo_manual_regulatory_checks"."holds") > 0 OR jsonb_array_length("valo_manual_regulatory_checks"."sources") > 0))
);
--> statement-breakpoint
ALTER TABLE "valo_manual_library" DROP CONSTRAINT "valo_manual_state";--> statement-breakpoint
ALTER TABLE "valo_manual_library" ADD COLUMN "regulatory_check_id" uuid;--> statement-breakpoint
CREATE INDEX "valo_manual_regulatory_checked" ON "valo_manual_regulatory_checks" USING btree ("candidate_id","checked_at","id");--> statement-breakpoint
ALTER TABLE "valo_manual_library" ADD CONSTRAINT "valo_manual_regulatory_check_fk" FOREIGN KEY ("regulatory_check_id") REFERENCES "public"."valo_manual_regulatory_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_manual_library" ADD CONSTRAINT "valo_manual_state" CHECK ("valo_manual_library"."state" IN ('draft','published','replaced','withdrawn') AND (("valo_manual_library"."kind" = 'regulatory_article' AND "valo_manual_library"."state" <> 'draft') = ("valo_manual_library"."regulatory_check_id" IS NOT NULL)));
--> statement-breakpoint
CREATE FUNCTION valo_manual_regulatory_owner(who text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT FROM valo_staff_assignments a JOIN valo_staff_role_changes c
      ON c.assignment_id = a.id AND c.actor_assignment_id = a.id AND c.target_identity_id = a.identity_id
    WHERE a.identity_id = who AND a.role = 'system' AND a.active AND a.grant_mode = 'permanent'
      AND a.expires_at IS NULL AND c.action = 'grant' AND c.role = 'system'
      AND c.actor_id LIKE 'operator-bootstrap:%'
  )
$$;
--> statement-breakpoint
CREATE FUNCTION valo_immutable_regulatory_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Record a new regulatory source check instead of changing history';
END $$;
--> statement-breakpoint
CREATE TRIGGER valo_immutable_regulatory_check BEFORE UPDATE OR DELETE ON valo_manual_regulatory_checks
FOR EACH ROW EXECUTE FUNCTION valo_immutable_regulatory_check();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION valo_guard_manual_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest valo_manual_library%ROWTYPE;
DECLARE proof valo_manual_regulatory_checks%ROWTYPE;
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
    IF OLD.state = 'draft' AND NEW.state = 'published' AND latest.id = NEW.id THEN
      actor := NEW.published_by;
      IF NEW.kind = 'regulatory_article' THEN
        SELECT * INTO proof FROM valo_manual_regulatory_checks WHERE id = NEW.regulatory_check_id;
        IF NOT FOUND OR actor = NEW.created_by OR proof.title <> NEW.title
           OR proof.body_sha256 <> encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex')
           OR cardinality(proof.holds) <> 0 OR jsonb_array_length(proof.sources) = 0
           OR EXISTS (SELECT FROM jsonb_array_elements(proof.sources) ref WHERE coalesce((ref->>'validThrough')::timestamptz,'-infinity') <= clock_timestamp())
           OR proof.checked_at > clock_timestamp() OR proof.checked_at < clock_timestamp() - interval '1 day' THEN
          RAISE EXCEPTION 'A current source check of this exact draft and a separate owner are required';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(proof.candidate_id, 812));
        IF EXISTS (SELECT FROM valo_manual_regulatory_checks c WHERE c.candidate_id = proof.candidate_id
                   AND (c.checked_at,c.id) > (proof.checked_at,proof.id)) THEN
          RAISE EXCEPTION 'Reopen the most recent regulatory source check';
        END IF;
        IF EXISTS (SELECT FROM valo_manual_library other
                   JOIN valo_manual_regulatory_checks c ON c.id = other.regulatory_check_id
                   WHERE c.candidate_id = proof.candidate_id AND other.state = 'published'
                   AND other.item_id <> NEW.item_id) THEN
          RAISE EXCEPTION 'Use the existing published article history';
        END IF;
      END IF;
    ELSIF OLD.state = 'published' AND NEW.state IN ('withdrawn','replaced') AND
          ROW(NEW.published_at, NEW.published_by, NEW.regulatory_check_id) IS NOT DISTINCT FROM
          ROW(OLD.published_at, OLD.published_by, OLD.regulatory_check_id) THEN
      actor := NEW.closed_by;
    ELSE
      RAISE EXCEPTION 'Invalid editorial transition';
    END IF;
    IF NEW.kind = 'regulatory_article' THEN
      IF NOT valo_manual_regulatory_owner(actor) THEN RAISE EXCEPTION 'The permanent development owner is required'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT FROM valo_staff_assignments WHERE identity_id = actor AND role = 'content'
                 AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'An active content editor is required';
  END IF;
  RETURN NEW;
END $$;
