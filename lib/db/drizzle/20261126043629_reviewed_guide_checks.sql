CREATE TABLE "valo_reviewed_guide_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_hash" text NOT NULL,
	"version_id" uuid NOT NULL,
	"guide_id" text NOT NULL,
	"version" integer NOT NULL,
	"candidate_hash" text NOT NULL,
	"captures" jsonb NOT NULL,
	"checked_by" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_reviewed_guide_checks_guide_check" CHECK ("valo_reviewed_guide_checks"."guide_id" ~ '^GUD-(0[1-9]|[12][0-9]|30)$' AND "valo_reviewed_guide_checks"."version" > 0),
	CONSTRAINT "valo_reviewed_guide_checks_hash_check" CHECK ("valo_reviewed_guide_checks"."candidate_hash" ~ '^[a-f0-9]{64}$' AND "valo_reviewed_guide_checks"."artifact_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "valo_reviewed_guide_checks_captures_check" CHECK (jsonb_typeof("valo_reviewed_guide_checks"."captures") = 'object' AND "valo_reviewed_guide_checks"."captures" <> '{}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "valo_reviewed_guide_checks" ADD CONSTRAINT "valo_reviewed_guide_checks_artifact_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."valo_prepared_candidates"("artifact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valo_reviewed_guide_checks_version_idx" ON "valo_reviewed_guide_checks" USING btree ("version_id","checked_at");