CREATE TABLE "valo_source_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"attempted_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone,
	"status" text NOT NULL,
	"http_status" integer,
	"mime" text,
	"raw_checksum" text,
	"text_checksum" text,
	"raw_object_key" text,
	"text_object_key" text,
	"bytes" integer,
	"extraction_version" text NOT NULL,
	"failure_code" text,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "valo_source_snapshot_source_date" ON "valo_source_snapshots" USING btree ("source_id","attempted_at");