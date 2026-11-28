CREATE TABLE "valo_email_suppressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key_version" text NOT NULL,
	"address_hash" text NOT NULL,
	"reason" text NOT NULL,
	"first_reported_at" timestamp with time zone NOT NULL,
	"last_reported_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "valo_email_suppression_shape" CHECK ("valo_email_suppressions"."reason" IN ('bounced', 'complained')
        AND "valo_email_suppressions"."address_hash" ~ '^[a-f0-9]{64}$'
        AND "valo_email_suppressions"."key_version" ~ '^[a-zA-Z0-9_-]{1,80}$'
        AND "valo_email_suppressions"."last_reported_at" >= "valo_email_suppressions"."first_reported_at"
        AND "valo_email_suppressions"."expires_at" > "valo_email_suppressions"."last_reported_at")
);
--> statement-breakpoint
ALTER TABLE "valo_email_events" ADD COLUMN "address_hash" text;--> statement-breakpoint
ALTER TABLE "valo_email_events" ADD COLUMN "address_key_version" text;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_email_suppression_once" ON "valo_email_suppressions" USING btree ("key_version","address_hash");--> statement-breakpoint
CREATE INDEX "valo_email_suppression_expiry_idx" ON "valo_email_suppressions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "valo_email_events" ADD CONSTRAINT "valo_email_event_address" CHECK (("valo_email_events"."address_hash" IS NULL) = ("valo_email_events"."address_key_version" IS NULL)
        AND ("valo_email_events"."address_hash" IS NULL OR ("valo_email_events"."address_hash" ~ '^[a-f0-9]{64}$'
          AND "valo_email_events"."address_key_version" ~ '^[a-zA-Z0-9_-]{1,80}$'
          AND "valo_email_events"."delivery" IN ('bounced', 'complained'))));