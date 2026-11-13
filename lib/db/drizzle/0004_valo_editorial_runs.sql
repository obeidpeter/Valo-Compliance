CREATE TABLE "valo_editorial_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"source_snapshot_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text,
	"candidate_hash" text,
	"source_hash" text NOT NULL,
	"output_hash" text,
	"object_key" text,
	"provider_response_id" text,
	"provider_request_id" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"failure_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "valo_editorial_role_check" CHECK ("valo_editorial_runs"."role" in ('draft','factual','challenge')),
	CONSTRAINT "valo_editorial_status_check" CHECK ("valo_editorial_runs"."status" in ('reserved','running','succeeded','failed','dependency_held'))
);
--> statement-breakpoint
ALTER TABLE "valo_editorial_runs" ADD CONSTRAINT "valo_editorial_runs_source_snapshot_id_valo_source_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."valo_source_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_editorial_pipeline_role" ON "valo_editorial_runs" USING btree ("pipeline_id","role");--> statement-breakpoint
CREATE INDEX "valo_editorial_created" ON "valo_editorial_runs" USING btree ("created_at");