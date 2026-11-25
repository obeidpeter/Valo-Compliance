CREATE TABLE "valo_acceptance_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corpus" text NOT NULL,
	"corpus_hash" text NOT NULL,
	"summary" jsonb NOT NULL,
	"cases" jsonb NOT NULL,
	"results_hash" text NOT NULL,
	"kept_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_acceptance_runs_corpus" CHECK ("valo_acceptance_runs"."corpus" IN ('editorial', 'checker', 'customer_ai')),
	CONSTRAINT "valo_acceptance_runs_corpus_hash" CHECK ("valo_acceptance_runs"."corpus_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "valo_acceptance_runs_results_hash" CHECK ("valo_acceptance_runs"."results_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "valo_acceptance_runs_kept_by" CHECK ("valo_acceptance_runs"."kept_by" ~ '^operator:[A-Za-z0-9._@-]{3,80}$'),
	CONSTRAINT "valo_acceptance_runs_summary" CHECK (jsonb_typeof("valo_acceptance_runs"."summary") = 'array' AND jsonb_array_length("valo_acceptance_runs"."summary") <= 20),
	CONSTRAINT "valo_acceptance_runs_cases" CHECK (jsonb_typeof("valo_acceptance_runs"."cases") = 'array' AND jsonb_array_length("valo_acceptance_runs"."cases") BETWEEN 1 AND 200
          AND octet_length("valo_acceptance_runs"."cases"::text) <= 2000000)
);
--> statement-breakpoint
CREATE INDEX "valo_acceptance_runs_latest" ON "valo_acceptance_runs" USING btree ("corpus","created_at");--> statement-breakpoint
-- A suite's run kept for an independent reviewer (docs/architecture/reviewer-record.md, slice 2). A kept
-- run is dated by the database and never changed, removed or truncated, so a decision on one of its
-- cases is about what the reviewer read. Each case names itself, its hash, its status and the hash of
-- the case as kept, once. A missing field is refused too: a null passes a check, so each test is
-- coalesced.
CREATE FUNCTION public.valo_guard_acceptance_run() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A kept run is never changed or removed'; END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(NEW.cases) c
             WHERE coalesce(jsonb_typeof(c), '') <> 'object'
                OR coalesce(jsonb_typeof(c->'caseId'), '') <> 'string'
                OR coalesce(jsonb_typeof(c->'status'), '') <> 'string'
                OR coalesce(c->>'caseHash', '') !~ '^[a-f0-9]{64}$'
                OR coalesce(c->>'resultHash', '') !~ '^[a-f0-9]{64}$'
                OR coalesce(jsonb_typeof(c->'review'), '') NOT IN ('object', 'null')) THEN
    RAISE EXCEPTION 'Each kept case names the case, its hash, its status, its review and the hash of the case as kept';
  END IF;
  IF (SELECT count(DISTINCT c->>'caseId') FROM jsonb_array_elements(NEW.cases) c) <> jsonb_array_length(NEW.cases) THEN
    RAISE EXCEPTION 'A kept run lists each case once';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_acceptance_run() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_acceptance_run BEFORE INSERT OR UPDATE OR DELETE ON public.valo_acceptance_runs
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_acceptance_run();--> statement-breakpoint
CREATE TRIGGER valo_acceptance_runs_no_truncate BEFORE TRUNCATE ON public.valo_acceptance_runs
FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
-- A decision on a run outcome is taken only on a case that a kept run of the same corpus left for a
-- reviewer, with the case's hash and the hash of the case as kept. A decision on an expected outcome is
-- taken as before. A row without the fields its kind needs is left to valo_acceptance_reviews_judgment,
-- which is checked after this trigger, so it is refused by that check's name.
CREATE OR REPLACE FUNCTION public.valo_guard_acceptance_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A review decision is never changed or removed'; END IF;
  IF NOT EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.reviewer AND role = 'reviewer'
                 AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'An active reviewer is required';
  END IF;
  IF NEW.judgment = 'run_outcome' AND NEW.answer IN ('met', 'not_met') AND NEW.run_id IS NOT NULL
     AND coalesce(NEW.results_hash, '') ~ '^[a-f0-9]{64}$' AND NOT EXISTS (
       SELECT FROM public.valo_acceptance_runs r, jsonb_array_elements(r.cases) c
       WHERE r.id::text = NEW.run_id AND r.corpus = NEW.corpus
         AND c->>'caseId' = NEW.case_id AND c->>'caseHash' = NEW.case_hash
         AND c->>'resultHash' = NEW.results_hash AND jsonb_typeof(c->'review') = 'object') THEN
    RAISE EXCEPTION 'A run decision is taken only on a case a kept run left for a reviewer, as it was kept';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
