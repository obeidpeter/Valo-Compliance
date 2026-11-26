CREATE TABLE "valo_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"class" text NOT NULL,
	"recipient_identity_id" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sender" text,
	"provider_message_id" text,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_message_shape" CHECK (("valo_messages"."kind", "valo_messages"."class") IN (('purchase_receipt', 'necessary'), ('refund_processed', 'necessary'))
        AND "valo_messages"."status" IN ('queued', 'sending', 'held', 'accepted', 'failed', 'cancelled')
        AND ("valo_messages"."reason" IS NULL OR "valo_messages"."reason" ~ '^[A-Z][A-Z0-9_]{2,63}$')
        AND "valo_messages"."attempts" BETWEEN 0 AND 5
        AND ("valo_messages"."sender" IS NULL OR "valo_messages"."sender" ~ '^[a-z][a-z0-9-]{1,39}$')
        AND ("valo_messages"."provider_message_id" IS NULL OR length("valo_messages"."provider_message_id") BETWEEN 1 AND 200)
        AND length("valo_messages"."recipient_identity_id") BETWEEN 1 AND 200),
	CONSTRAINT "valo_message_state" CHECK (("valo_messages"."status" = 'sending') = ("valo_messages"."lease_token" IS NOT NULL AND "valo_messages"."lease_until" IS NOT NULL)
        AND ("valo_messages"."status" <> 'sending' OR "valo_messages"."attempts" >= 1)
        AND ("valo_messages"."status" <> 'accepted' OR ("valo_messages"."sender" IS NOT NULL AND "valo_messages"."provider_message_id" IS NOT NULL
          AND "valo_messages"."accepted_at" IS NOT NULL))
        AND ("valo_messages"."accepted_at" IS NULL OR "valo_messages"."status" = 'accepted')
        AND ("valo_messages"."attempts" = 0) = ("valo_messages"."first_attempt_at" IS NULL)
        AND ("valo_messages"."attempts" = 0) = ("valo_messages"."last_attempt_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "valo_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_messages" ADD CONSTRAINT "valo_messages_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_message_once" ON "valo_messages" USING btree ("workspace_id","kind","subject_id");--> statement-breakpoint
CREATE INDEX "valo_message_dispatch_idx" ON "valo_messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "valo_message_workspace_idx" ON "valo_messages" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_messages" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_messages"."workspace_id" = (select valo_scope_workspace())) WITH CHECK ("valo_messages"."workspace_id" = (select valo_scope_workspace()));