CREATE TABLE "valo_commercial_setting_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_id" uuid NOT NULL,
	"action" text NOT NULL,
	"setting" jsonb NOT NULL,
	"changed_by" text DEFAULT current_user NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_commercial_setting_changes_action_check" CHECK ("valo_commercial_setting_changes"."action" IN ('created', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "valo_commercial_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"approval_reference" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_commercial_settings_value_check" CHECK (CASE WHEN "valo_commercial_settings"."key" IN ('drafting_workspace_daily', 'drafting_daily_in_all') AND jsonb_typeof("valo_commercial_settings"."value") = 'number' THEN ("valo_commercial_settings"."value")::numeric >= 0 AND ("valo_commercial_settings"."value")::numeric = trunc(("valo_commercial_settings"."value")::numeric) ELSE false END),
	CONSTRAINT "valo_commercial_settings_approval_reference_check" CHECK (length("valo_commercial_settings"."approval_reference") > 0),
	CONSTRAINT "valo_commercial_settings_check" CHECK ("valo_commercial_settings"."effective_to" IS NULL OR "valo_commercial_settings"."effective_to" > "valo_commercial_settings"."effective_from")
);
--> statement-breakpoint
CREATE INDEX "valo_commercial_setting_changes_setting_idx" ON "valo_commercial_setting_changes" USING btree ("setting_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_commercial_settings_open_unique" ON "valo_commercial_settings" USING btree ("key") WHERE "valo_commercial_settings"."effective_to" IS NULL;