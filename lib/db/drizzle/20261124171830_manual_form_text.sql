ALTER TABLE "valo_manual_library" ADD COLUMN "form_text" text;--> statement-breakpoint
ALTER TABLE "valo_manual_library" ADD CONSTRAINT "valo_manual_form_text" CHECK ("valo_manual_library"."form_text" IS NULL OR ("valo_manual_library"."kind" IN ('template','premium_template') AND length("valo_manual_library"."form_text") BETWEEN 1 AND 60000));--> statement-breakpoint
-- A revision's form text is part of the text an editor previews and releases: like the rest of it,
-- it cannot change once saved (forms v2, docs/architecture/forms-v2.md).
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
           NEW.digest, NEW.file_format, NEW.file_bytes, NEW.created_by, NEW.created_at, NEW.form_text)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.item_id, OLD.version, OLD.slug, OLD.kind, OLD.industry, OLD.title, OLD.body,
           OLD.digest, OLD.file_format, OLD.file_bytes, OLD.created_by, OLD.created_at, OLD.form_text) THEN
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
