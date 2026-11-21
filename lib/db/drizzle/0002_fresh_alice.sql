CREATE TABLE "valo_export_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"format" text NOT NULL,
	"render_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"requested_by" text NOT NULL,
	"queue_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_cycles" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_export_requests" (
	"workspace_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"fingerprint" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_file_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"checksum" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"retention_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Reviewed ordering correction: referenced composite unique indexes must exist before foreign keys.
CREATE UNIQUE INDEX "valo_document_workspace_unique" ON "valo_documents" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_revision_document_workspace_unique" ON "valo_document_revisions" USING btree ("id","document_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_export_workspace_unique" ON "valo_export_jobs" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "valo_export_jobs" ADD CONSTRAINT "valo_export_jobs_revision_id_document_id_workspace_id_valo_document_revisions_id_document_id_workspace_id_fk" FOREIGN KEY ("revision_id","document_id","workspace_id") REFERENCES "public"."valo_document_revisions"("id","document_id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_export_requests" ADD CONSTRAINT "valo_export_requests_job_id_workspace_id_valo_export_jobs_id_workspace_id_fk" FOREIGN KEY ("job_id","workspace_id") REFERENCES "public"."valo_export_jobs"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_file_assets" ADD CONSTRAINT "valo_file_assets_job_id_workspace_id_valo_export_jobs_id_workspace_id_fk" FOREIGN KEY ("job_id","workspace_id") REFERENCES "public"."valo_export_jobs"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_export_revision_format_unique" ON "valo_export_jobs" USING btree ("workspace_id","revision_id","format","render_version");--> statement-breakpoint
CREATE INDEX "valo_export_dispatch_idx" ON "valo_export_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_export_request_key_unique" ON "valo_export_requests" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_export_file_unique" ON "valo_file_assets" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "valo_document_revisions" ADD CONSTRAINT "valo_document_revisions_document_id_workspace_id_valo_documents_id_workspace_id_fk" FOREIGN KEY ("document_id","workspace_id") REFERENCES "public"."valo_documents"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint