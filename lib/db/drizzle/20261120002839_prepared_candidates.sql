-- Decision 0014: a template candidate awaiting its two reviews is a private, hash-bound artifact,
-- not a saved version. valo_prepared_candidates records each one so staff can find it: its
-- artifact, the version ID and number it will be saved under, its template and candidate hash, and
-- when it was prepared and must be reviewed by. The table matches the Drizzle schema; the grant is
-- hand-written. The preparer adds rows as valo_content_drafter_dev, which can only read and add
-- them. The scoped customer role gets nothing.
CREATE TABLE "valo_prepared_candidates" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"artifact_hash" text NOT NULL,
	"version_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"candidate_hash" text NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL,
	"review_by" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_prepared_candidates_artifact_hash_check" CHECK ("valo_prepared_candidates"."artifact_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "valo_prepared_candidates_candidate_hash_check" CHECK ("valo_prepared_candidates"."candidate_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "valo_prepared_candidates_version_check" CHECK ("valo_prepared_candidates"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "valo_prepared_candidates_version_id_unique" ON "valo_prepared_candidates" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "valo_prepared_candidates_template_idx" ON "valo_prepared_candidates" USING btree ("template_id","version");--> statement-breakpoint
GRANT SELECT, INSERT ON "valo_prepared_candidates" TO valo_content_drafter_dev;
