CREATE TABLE "valo_source_review_preparations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"candidate_artifact_id" uuid,
	"held_version_id" uuid,
	"candidate_version" integer,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "valo_source_review_preparations_status" CHECK ("valo_source_review_preparations"."status" IN ('pending', 'running', 'prepared', 'held', 'not_ready', 'failed', 'closed')),
	CONSTRAINT "valo_source_review_preparations_attempts" CHECK ("valo_source_review_preparations"."attempts" BETWEEN 0 AND 3),
	CONSTRAINT "valo_source_review_preparations_outcome" CHECK (jsonb_typeof("valo_source_review_preparations"."reasons") = 'array' AND length("valo_source_review_preparations"."reasons"::text) <= 4000
        AND ("valo_source_review_preparations"."candidate_version" IS NULL OR "valo_source_review_preparations"."candidate_version" > 0) AND CASE
        WHEN "valo_source_review_preparations"."status" IN ('pending', 'running') THEN "valo_source_review_preparations"."completed_at" IS NULL
          AND "valo_source_review_preparations"."candidate_artifact_id" IS NULL AND "valo_source_review_preparations"."held_version_id" IS NULL AND "valo_source_review_preparations"."candidate_version" IS NULL
          AND "valo_source_review_preparations"."reasons" = '[]'::jsonb
        WHEN "valo_source_review_preparations"."status" = 'prepared' THEN "valo_source_review_preparations"."completed_at" IS NOT NULL
          AND "valo_source_review_preparations"."candidate_artifact_id" IS NOT NULL AND "valo_source_review_preparations"."held_version_id" IS NULL AND "valo_source_review_preparations"."candidate_version" IS NOT NULL
          AND "valo_source_review_preparations"."reasons" = '[]'::jsonb
        WHEN "valo_source_review_preparations"."status" = 'held' THEN "valo_source_review_preparations"."completed_at" IS NOT NULL
          AND "valo_source_review_preparations"."candidate_artifact_id" IS NULL AND "valo_source_review_preparations"."held_version_id" IS NOT NULL AND "valo_source_review_preparations"."candidate_version" IS NOT NULL
          AND "valo_source_review_preparations"."reasons" <> '[]'::jsonb
        WHEN "valo_source_review_preparations"."status" IN ('not_ready', 'failed') THEN "valo_source_review_preparations"."completed_at" IS NOT NULL
          AND "valo_source_review_preparations"."candidate_artifact_id" IS NULL AND "valo_source_review_preparations"."held_version_id" IS NULL AND "valo_source_review_preparations"."reasons" <> '[]'::jsonb
        ELSE "valo_source_review_preparations"."completed_at" IS NOT NULL AND "valo_source_review_preparations"."candidate_artifact_id" IS NULL AND "valo_source_review_preparations"."held_version_id" IS NULL
          AND "valo_source_review_preparations"."candidate_version" IS NULL AND "valo_source_review_preparations"."reasons" = '[]'::jsonb
        END)
);
--> statement-breakpoint
ALTER TABLE "valo_source_review_preparations" ADD CONSTRAINT "valo_source_review_preparations_work_fk" FOREIGN KEY ("work_id") REFERENCES "public"."valo_source_review_work"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_source_review_preparations" ADD CONSTRAINT "valo_source_review_preparations_candidate_fk" FOREIGN KEY ("candidate_artifact_id") REFERENCES "public"."valo_prepared_candidates"("artifact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_source_review_preparations" ADD CONSTRAINT "valo_source_review_preparations_held_version_fk" FOREIGN KEY ("held_version_id") REFERENCES "public"."valo_content_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_source_review_preparations_open" ON "valo_source_review_preparations" USING btree ("work_id") WHERE "valo_source_review_preparations"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "valo_source_review_preparations_due" ON "valo_source_review_preparations" USING btree ("status","requested_at");--> statement-breakpoint
-- A request to prepare a candidate from review work (docs/architecture/source-register.md, slice 4). It is
-- made on open review work of a template or guide, by an active Content editor, dated by the database, and
-- never removed. Who asked, for which row and when never change, and a finished request never changes.
CREATE FUNCTION public.valo_guard_source_review_preparation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A preparation request is never removed'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT FROM public.valo_source_review_work w JOIN public.valo_source_impacts i ON i.id = w.impact_id
                   WHERE w.id = NEW.work_id AND w.status = 'awaiting_authorized_review' AND i.target_kind = 'content') THEN
      RAISE EXCEPTION 'A candidate is prepared only from open review work on a template or guide';
    END IF;
    IF NOT EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.requested_by AND role = 'content'
                   AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) THEN
      RAISE EXCEPTION 'An active content editor is required';
    END IF;
    IF NEW.status <> 'pending' OR NEW.attempts <> 0 OR NEW.lease_until IS NOT NULL THEN
      RAISE EXCEPTION 'A preparation request starts waiting, untried';
    END IF;
    NEW.requested_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.work_id <> OLD.work_id OR NEW.requested_by <> OLD.requested_by
     OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'A preparation request keeps who asked, for which row and when';
  END IF;
  IF OLD.status NOT IN ('pending', 'running') THEN
    RAISE EXCEPTION 'A finished preparation request never changes';
  END IF;
  IF NEW.attempts < OLD.attempts THEN RAISE EXCEPTION 'A preparation request keeps every attempt'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_source_review_preparation() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_source_review_preparation BEFORE INSERT OR UPDATE OR DELETE ON public.valo_source_review_preparations
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_source_review_preparation();
