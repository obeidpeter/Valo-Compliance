CREATE TABLE "valo_rate_buckets" (
	"bucket" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"used_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "valo_rate_buckets_bucket_subject_hash_window_started_at_pk" PRIMARY KEY("bucket","subject_hash","window_started_at"),
	CONSTRAINT "valo_rate_buckets_positive" CHECK ("valo_rate_buckets"."used_count" > 0)
);
--> statement-breakpoint
CREATE INDEX "valo_rate_buckets_expiry_idx" ON "valo_rate_buckets" USING btree ("expires_at");