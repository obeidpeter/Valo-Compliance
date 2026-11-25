CREATE TABLE "valo_acceptance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corpus" text NOT NULL,
	"case_id" text NOT NULL,
	"case_hash" text NOT NULL,
	"judgment" text NOT NULL,
	"run_id" text,
	"results_hash" text,
	"answer" text NOT NULL,
	"reason" text NOT NULL,
	"reviewer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_acceptance_reviews_corpus" CHECK ("valo_acceptance_reviews"."corpus" IN ('editorial', 'checker', 'customer_ai')),
	CONSTRAINT "valo_acceptance_reviews_case_id" CHECK ("valo_acceptance_reviews"."case_id" ~ '^[A-Z0-9][A-Z0-9-]{2,63}$'),
	CONSTRAINT "valo_acceptance_reviews_case_hash" CHECK ("valo_acceptance_reviews"."case_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "valo_acceptance_reviews_reason" CHECK (length("valo_acceptance_reviews"."reason") BETWEEN 20 AND 2000),
	CONSTRAINT "valo_acceptance_reviews_reviewer" CHECK (length("valo_acceptance_reviews"."reviewer") BETWEEN 1 AND 200),
	CONSTRAINT "valo_acceptance_reviews_judgment" CHECK (("valo_acceptance_reviews"."judgment" = 'expected_outcome' AND "valo_acceptance_reviews"."answer" IN ('confirmed', 'rejected')
          AND "valo_acceptance_reviews"."run_id" IS NULL AND "valo_acceptance_reviews"."results_hash" IS NULL)
        OR ("valo_acceptance_reviews"."judgment" = 'run_outcome' AND "valo_acceptance_reviews"."answer" IN ('met', 'not_met')
          AND "valo_acceptance_reviews"."run_id" IS NOT NULL AND "valo_acceptance_reviews"."results_hash" IS NOT NULL
          AND length("valo_acceptance_reviews"."run_id") BETWEEN 1 AND 200 AND "valo_acceptance_reviews"."results_hash" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "valo_staff_assignments" DROP CONSTRAINT "valo_staff_assignments_role_check";--> statement-breakpoint
CREATE INDEX "valo_acceptance_reviews_case" ON "valo_acceptance_reviews" USING btree ("corpus","case_id","created_at");--> statement-breakpoint
ALTER TABLE "valo_staff_assignments" ADD CONSTRAINT "valo_staff_assignments_role_check" CHECK ("valo_staff_assignments"."role" IN ('content', 'support', 'finance', 'system', 'privacy', 'reviewer'));--> statement-breakpoint
-- An independent reviewer's decisions (decision 0016, docs/architecture/reviewer-record.md). A decision is
-- recorded only by an active reviewer, dated by the database, and never changed, removed or truncated.
CREATE FUNCTION public.valo_guard_acceptance_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A review decision is never changed or removed'; END IF;
  IF NOT EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.reviewer AND role = 'reviewer'
                 AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'An active reviewer is required';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_acceptance_review() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_acceptance_review BEFORE INSERT OR UPDATE OR DELETE ON public.valo_acceptance_reviews
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_acceptance_review();--> statement-breakpoint
CREATE TRIGGER valo_acceptance_reviews_no_truncate BEFORE TRUNCATE ON public.valo_acceptance_reviews
FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
-- No one holds the reviewer and content roles at once, so no one who prepares content confirms its cases.
-- An emergency grant counts while it lasts. Grants of the two roles to one identity are serialised, so two
-- at once cannot both pass.
CREATE FUNCTION public.valo_guard_reviewer_independence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE other text;
BEGIN
  IF NOT NEW.active OR NEW.role NOT IN ('reviewer', 'content')
     OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= clock_timestamp()) THEN
    RETURN NEW;
  END IF;
  other := CASE NEW.role WHEN 'reviewer' THEN 'content' ELSE 'reviewer' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('valo:reviewer-independence:' || NEW.identity_id, 0));
  IF EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.identity_id AND role = other
             AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'A reviewer cannot also hold the content role';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_reviewer_independence() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_reviewer_independence BEFORE INSERT OR UPDATE ON public.valo_staff_assignments
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_reviewer_independence();
