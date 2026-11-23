CREATE TABLE "valo_rule_owner_signoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"version" integer NOT NULL,
	"manifest_hash" text NOT NULL,
	"owner_identity_id" text NOT NULL,
	"source_checked_at" timestamp with time zone NOT NULL,
	"confirmed_checks" jsonb NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_rule_owner_signoff_manifest" CHECK ("valo_rule_owner_signoffs"."manifest_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "valo_rule_owner_signoff_version" ON "valo_rule_owner_signoffs" USING btree ("rule_id","version");--> statement-breakpoint
-- Decision 0020: a requirements-checker rule released on the development owner's sign-off. A
-- sign-off is never changed or removed. A release that says it is owner-signed is refused unless a
-- sign-off of its exact manifest was made in the same transaction, by the designated development
-- owner, on a source check under a day old, confirming EDP-005's enhanced checks for any risk but
-- general. An owner-signed release keeps its rule, bundle and manifest, changes only its status, and
-- is never deleted. It leaves publication once, superseded or withdrawn, and is never published again:
-- that takes a new version and a new sign-off. Releases on the reviewed route are unchanged.
CREATE FUNCTION valo_rule_owner_signoff_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A rule sign-off is never changed or removed' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER valo_rule_owner_signoff_immutable BEFORE UPDATE OR DELETE ON valo_rule_owner_signoffs
  FOR EACH ROW EXECUTE FUNCTION valo_rule_owner_signoff_immutable();
--> statement-breakpoint
CREATE TRIGGER valo_rule_owner_signoff_no_truncate BEFORE TRUNCATE ON valo_rule_owner_signoffs
  FOR EACH STATEMENT EXECUTE FUNCTION valo_rule_owner_signoff_immutable();
--> statement-breakpoint
CREATE FUNCTION valo_guard_owner_signed_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.rule->>'provenance' = 'owner_signoff' THEN
      RAISE EXCEPTION 'An owner-signed rule release is kept' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.rule->>'provenance' = 'owner_signoff' OR NEW.rule->>'provenance' = 'owner_signoff'
       OR OLD.publication_bundle->>'kind' = 'owner_signoff' OR NEW.publication_bundle->>'kind' = 'owner_signoff' THEN
      IF ROW(NEW.id, NEW.rule_id, NEW.version, NEW.rule, NEW.publication_bundle, NEW.manifest_hash, NEW.published_at)
         IS DISTINCT FROM
         ROW(OLD.id, OLD.rule_id, OLD.version, OLD.rule, OLD.publication_bundle, OLD.manifest_hash, OLD.published_at) THEN
        RAISE EXCEPTION 'An owner-signed rule release changes only its status' USING ERRCODE = '23514';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status
         AND (OLD.status IS DISTINCT FROM 'published' OR NEW.status NOT IN ('superseded', 'withdrawn')) THEN
        RAISE EXCEPTION 'An owner-signed rule release leaves publication once and is never published again: sign a new version' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.rule->>'provenance' IS DISTINCT FROM 'owner_signoff'
     AND NEW.publication_bundle->>'kind' IS DISTINCT FROM 'owner_signoff' THEN
    RETURN NEW;
  END IF;
  IF NEW.rule->>'provenance' IS DISTINCT FROM 'owner_signoff'
     OR NEW.publication_bundle->>'kind' IS DISTINCT FROM 'owner_signoff'
     OR NEW.rule->>'id' IS DISTINCT FROM NEW.rule_id
     OR NEW.rule->>'version' IS DISTINCT FROM NEW.version::text
     OR NEW.rule->>'manifestHash' IS DISTINCT FROM NEW.manifest_hash THEN
    RAISE EXCEPTION 'An owner-signed rule and its bundle must name each other' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT FROM valo_rule_owner_signoffs s
    WHERE s.rule_id = NEW.rule_id AND s.version = NEW.version AND s.manifest_hash = NEW.manifest_hash
      AND s.signed_at = now()
      AND s.source_checked_at <= now() AND s.source_checked_at > now() - interval '1 day'
      AND (NEW.publication_bundle->'candidate'->>'risk' = 'general'
           OR s.confirmed_checks @> '["controlling_text","amendments","effective_dates","exceptions","jurisdiction"]'::jsonb)
      AND valo_manual_regulatory_owner(s.owner_identity_id)
  ) THEN
    RAISE EXCEPTION 'The development owner''s sign-off of this exact rule version is required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER valo_guard_owner_signed_rule BEFORE INSERT OR UPDATE OR DELETE ON valo_rule_releases
  FOR EACH ROW EXECUTE FUNCTION valo_guard_owner_signed_rule();
