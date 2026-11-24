DROP INDEX "valo_export_revision_format_unique";--> statement-breakpoint
ALTER TABLE "valo_export_jobs" ADD COLUMN "finished" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_export_revision_format_unique" ON "valo_export_jobs" USING btree ("workspace_id","revision_id","format","render_version","finished");