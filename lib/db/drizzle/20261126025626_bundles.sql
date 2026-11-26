CREATE TABLE "valo_bundle_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_id" uuid NOT NULL,
	"action" text NOT NULL,
	"bundle" jsonb NOT NULL,
	"changed_by" text DEFAULT current_user NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_bundle_changes_action_check" CHECK ("valo_bundle_changes"."action" IN ('created', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "valo_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_key" text NOT NULL,
	"title" text NOT NULL,
	"items" uuid[] NOT NULL,
	"amount_kobo" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"licence_version" text NOT NULL,
	"licence_text" text NOT NULL,
	"tax_treatment" text NOT NULL,
	"approval_reference" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_bundles_key_check" CHECK ("valo_bundles"."bundle_key" ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
	CONSTRAINT "valo_bundles_title_check" CHECK (length("valo_bundles"."title") BETWEEN 3 AND 120),
	CONSTRAINT "valo_bundles_items_check" CHECK (cardinality("valo_bundles"."items") BETWEEN 2 AND 10),
	CONSTRAINT "valo_bundles_amount_kobo_check" CHECK ("valo_bundles"."amount_kobo" > 0),
	CONSTRAINT "valo_bundles_currency_check" CHECK ("valo_bundles"."currency" = 'NGN'),
	CONSTRAINT "valo_bundles_approval_reference_check" CHECK (length("valo_bundles"."approval_reference") > 0),
	CONSTRAINT "valo_bundles_check" CHECK ("valo_bundles"."effective_to" IS NULL OR "valo_bundles"."effective_to" > "valo_bundles"."effective_from")
);
--> statement-breakpoint
CREATE INDEX "valo_bundle_changes_bundle_idx" ON "valo_bundle_changes" USING btree ("bundle_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_bundles_open_unique" ON "valo_bundles" USING btree ("bundle_key") WHERE "valo_bundles"."effective_to" IS NULL;