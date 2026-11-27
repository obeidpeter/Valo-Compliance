CREATE TABLE "valo_consent_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"consent" text NOT NULL,
	"choice" boolean NOT NULL,
	"notice_version" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_consent_change_shape" CHECK ("valo_consent_changes"."consent" IN ('marketing', 'reminders') AND "valo_consent_changes"."notice_version" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "valo_consent_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_consent_changes" ADD CONSTRAINT "valo_consent_changes_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valo_consent_change_workspace" ON "valo_consent_changes" USING btree ("workspace_id","consent","created_at");--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_consent_changes" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_consent_changes"."workspace_id" = (select valo_scope_workspace())) WITH CHECK ("valo_consent_changes"."workspace_id" = (select valo_scope_workspace()));