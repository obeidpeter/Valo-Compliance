CREATE TABLE "valo_privacy_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"placed_by" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" text,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "valo_privacy_hold_shape" CHECK (char_length("valo_privacy_holds"."reason") BETWEEN 10 AND 1000 AND (("valo_privacy_holds"."released_by" IS NULL AND "valo_privacy_holds"."released_at" IS NULL AND "valo_privacy_holds"."release_reason" IS NULL) OR ("valo_privacy_holds"."released_by" IS NOT NULL AND "valo_privacy_holds"."released_at" IS NOT NULL AND char_length("valo_privacy_holds"."release_reason") BETWEEN 10 AND 1000)))
);
--> statement-breakpoint
ALTER TABLE "valo_privacy_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_privacy_holds" ADD CONSTRAINT "valo_privacy_holds_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valo_privacy_hold_workspace" ON "valo_privacy_holds" USING btree ("workspace_id","released_at");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_privacy_hold_standing" ON "valo_privacy_holds" USING btree ("workspace_id") WHERE "valo_privacy_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_privacy_holds" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_privacy_holds"."workspace_id" = (select valo_scope_workspace())) WITH CHECK ("valo_privacy_holds"."workspace_id" = (select valo_scope_workspace()));