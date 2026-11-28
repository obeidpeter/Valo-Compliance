CREATE TABLE "valo_notice_digests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_notice_digest_day_ended" CHECK ("valo_notice_digests"."day" < ("valo_notice_digests"."created_at" AT TIME ZONE 'Africa/Lagos')::date)
);
--> statement-breakpoint
ALTER TABLE "valo_notice_digests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_messages" DROP CONSTRAINT "valo_message_shape";--> statement-breakpoint
ALTER TABLE "valo_notice_digests" ADD CONSTRAINT "valo_notice_digests_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_notice_digest_once" ON "valo_notice_digests" USING btree ("workspace_id","day");--> statement-breakpoint
ALTER TABLE "valo_messages" ADD CONSTRAINT "valo_message_shape" CHECK (("valo_messages"."kind", "valo_messages"."class") IN (('purchase_receipt', 'necessary'), ('refund_processed', 'necessary'),
          ('notices_digest', 'necessary'))
        AND "valo_messages"."status" IN ('queued', 'sending', 'held', 'accepted', 'failed', 'cancelled')
        AND ("valo_messages"."reason" IS NULL OR "valo_messages"."reason" ~ '^[A-Z][A-Z0-9_]{2,63}$')
        AND "valo_messages"."attempts" BETWEEN 0 AND 5
        AND ("valo_messages"."sender" IS NULL OR "valo_messages"."sender" ~ '^[a-z][a-z0-9-]{1,39}$')
        AND ("valo_messages"."provider_message_id" IS NULL OR length("valo_messages"."provider_message_id") BETWEEN 1 AND 200)
        AND length("valo_messages"."recipient_identity_id") BETWEEN 1 AND 200);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_notice_digests" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_notice_digests"."workspace_id" = (select valo_scope_workspace())) WITH CHECK ("valo_notice_digests"."workspace_id" = (select valo_scope_workspace()));