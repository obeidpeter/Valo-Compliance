CREATE TABLE "valo_operational_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"state" text NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"reading" integer,
	"threshold" integer,
	"runbook" text,
	"accountable" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_operational_alerts_code_check" CHECK ("valo_operational_alerts"."code" ~ '^[A-Z][A-Z_]{2,80}$'),
	CONSTRAINT "valo_operational_alerts_state_check" CHECK ("valo_operational_alerts"."state" IN ('active', 'resolved')),
	CONSTRAINT "valo_operational_alerts_reading_check" CHECK (("valo_operational_alerts"."reading" IS NULL OR "valo_operational_alerts"."reading" >= 0) AND ("valo_operational_alerts"."threshold" IS NULL OR "valo_operational_alerts"."threshold" >= 0))
);
--> statement-breakpoint
CREATE INDEX "valo_operational_alerts_raised_idx" ON "valo_operational_alerts" USING btree ("raised_at");--> statement-breakpoint
CREATE INDEX "valo_operational_alerts_code_idx" ON "valo_operational_alerts" USING btree ("code","raised_at");