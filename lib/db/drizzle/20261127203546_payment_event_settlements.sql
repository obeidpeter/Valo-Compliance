CREATE TABLE "valo_payment_event_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"finding" text NOT NULL,
	"resolved_by" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "valo_payment_event_settlements" ADD CONSTRAINT "valo_payment_event_settlement_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."valo_payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_payment_event_settlement_unique" ON "valo_payment_event_settlements" USING btree ("event_id","finding");