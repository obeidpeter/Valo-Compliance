-- Support cases, conversations, staff actions and content referrals (PR 31, first
-- numbered 0033). Tables and constraints match the Drizzle schema; the append-only
-- trigger and the backfill of existing intake are hand-written.
CREATE TABLE "valo_support_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_support_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"ticket_id" uuid,
	"access_id" uuid,
	"workspace_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_support_cases_ticket_id_unique" UNIQUE("ticket_id"),
	CONSTRAINT "valo_support_cases_access_id_unique" UNIQUE("access_id"),
	CONSTRAINT "valo_support_cases_source_kind_check" CHECK ("valo_support_cases"."source_kind" IN ('workspace','access')),
	CONSTRAINT "valo_support_cases_status_check" CHECK ("valo_support_cases"."status" IN ('open','in_progress','awaiting_customer','resolved')),
	CONSTRAINT "valo_support_cases_version_check" CHECK ("valo_support_cases"."version" > 0),
	CONSTRAINT "valo_support_case_source" CHECK (("valo_support_cases"."source_kind"='workspace' AND "valo_support_cases"."ticket_id" IS NOT NULL AND "valo_support_cases"."access_id" IS NULL AND "valo_support_cases"."workspace_id" IS NOT NULL)
    OR ("valo_support_cases"."source_kind"='access' AND "valo_support_cases"."access_id" IS NOT NULL AND "valo_support_cases"."ticket_id" IS NULL AND "valo_support_cases"."workspace_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "valo_support_escalations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_hash" text NOT NULL,
	"target_version" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_impact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_support_escalations_target_kind_check" CHECK ("valo_support_escalations"."target_kind" IN ('content','rule')),
	CONSTRAINT "valo_support_escalations_target_version_check" CHECK ("valo_support_escalations"."target_version" > 0),
	CONSTRAINT "valo_support_escalations_reason_check" CHECK (char_length("valo_support_escalations"."reason") BETWEEN 8 AND 4000),
	CONSTRAINT "valo_support_escalations_status_check" CHECK ("valo_support_escalations"."status" IN ('queued','acknowledged','resolved'))
);
--> statement-breakpoint
CREATE TABLE "valo_support_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_support_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"workspace_id" uuid,
	"author_id" text NOT NULL,
	"author_kind" text NOT NULL,
	"visibility" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_support_message_body" CHECK (char_length("valo_support_messages"."body") BETWEEN 8 AND 4000),
	CONSTRAINT "valo_support_messages_author_kind_check" CHECK ("valo_support_messages"."author_kind" IN ('customer','staff')),
	CONSTRAINT "valo_support_messages_visibility_check" CHECK ("valo_support_messages"."visibility" IN ('customer','internal'))
);
--> statement-breakpoint
ALTER TABLE "valo_support_actions" ADD CONSTRAINT "valo_support_actions_case_id_valo_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."valo_support_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_cases" ADD CONSTRAINT "valo_support_cases_ticket_id_valo_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."valo_support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_cases" ADD CONSTRAINT "valo_support_cases_access_id_valo_access_support_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."valo_access_support"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_cases" ADD CONSTRAINT "valo_support_cases_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_cases" ADD CONSTRAINT "valo_support_case_workspace" FOREIGN KEY ("ticket_id","workspace_id") REFERENCES "public"."valo_support_tickets"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_escalations" ADD CONSTRAINT "valo_support_escalations_case_id_valo_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."valo_support_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_events" ADD CONSTRAINT "valo_support_events_case_id_valo_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."valo_support_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_messages" ADD CONSTRAINT "valo_support_messages_case_id_valo_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."valo_support_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_messages" ADD CONSTRAINT "valo_support_messages_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_support_action_request" ON "valo_support_actions" USING btree ("case_id","actor_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "valo_support_case_queue" ON "valo_support_cases" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "valo_support_escalation_queue" ON "valo_support_escalations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "valo_support_message_case" ON "valo_support_messages" USING btree ("case_id","created_at");
--> statement-breakpoint
-- Support actions and events are append-only while their case is retained.
CREATE FUNCTION valo_support_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM valo_support_cases WHERE id=OLD.case_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Support action and event history is append only while its case is retained';
END $$;
--> statement-breakpoint
CREATE TRIGGER valo_support_events_immutable BEFORE UPDATE OR DELETE ON valo_support_events FOR EACH ROW EXECUTE FUNCTION valo_support_audit_immutable();
--> statement-breakpoint
CREATE TRIGGER valo_support_actions_immutable BEFORE UPDATE OR DELETE ON valo_support_actions FOR EACH ROW EXECUTE FUNCTION valo_support_audit_immutable();
--> statement-breakpoint
-- Existing durable intake becomes an open workflow, not a fabricated reply,
-- assignment, delivery or resolution. Preserve every original ticket/reference.
INSERT INTO valo_support_cases(id,source_kind,ticket_id,workspace_id,created_at,updated_at)
SELECT id,'workspace',id,workspace_id,created_at,created_at FROM valo_support_tickets
WHERE NOT EXISTS (SELECT 1 FROM valo_privacy_tombstones p WHERE p.workspace_id=valo_support_tickets.workspace_id);
--> statement-breakpoint
INSERT INTO valo_support_cases(id,source_kind,access_id,created_at,updated_at)
SELECT id,'access',id,created_at,created_at FROM valo_access_support;
