CREATE TABLE "valo_email_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"delivery" text NOT NULL,
	"detail" text,
	"provider_message_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "valo_email_event_shape" CHECK ("valo_email_events"."provider" ~ '^[a-z][a-z0-9-]{1,39}$'
        AND length("valo_email_events"."event_key") BETWEEN 1 AND 200
        AND "valo_email_events"."delivery" IN ('delivered', 'delayed', 'bounced', 'complained', 'undelivered')
        AND ("valo_email_events"."detail" IS NULL OR "valo_email_events"."detail" ~ '^[A-Z][A-Z0-9_]{2,63}$')
        AND length("valo_email_events"."provider_message_id") BETWEEN 1 AND 200
        AND "valo_email_events"."status" IN ('pending', 'applied', 'unmatched')
        AND ("valo_email_events"."status" = 'pending') = ("valo_email_events"."settled_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "valo_message_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"record_id" uuid NOT NULL,
	"delivery" text NOT NULL,
	"detail" text,
	"reported_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_message_delivery_shape" CHECK ("valo_message_deliveries"."source" IN ('message', 'reminder')
        AND "valo_message_deliveries"."delivery" IN ('delivered', 'delayed', 'bounced', 'complained', 'undelivered')
        AND ("valo_message_deliveries"."detail" IS NULL OR "valo_message_deliveries"."detail" ~ '^[A-Z][A-Z0-9_]{2,63}$'))
);
--> statement-breakpoint
ALTER TABLE "valo_message_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_message_deliveries" ADD CONSTRAINT "valo_message_deliveries_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_email_event_once" ON "valo_email_events" USING btree ("provider","event_key");--> statement-breakpoint
CREATE INDEX "valo_email_event_status_idx" ON "valo_email_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_message_delivery_once" ON "valo_message_deliveries" USING btree ("workspace_id","source","record_id");--> statement-breakpoint
CREATE INDEX "valo_reminder_provider_idx" ON "valo_reminder_outbox" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "valo_message_provider_idx" ON "valo_messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_message_deliveries" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_message_deliveries"."workspace_id" = (select valo_scope_workspace())) WITH CHECK ("valo_message_deliveries"."workspace_id" = (select valo_scope_workspace()));