CREATE TABLE "valo_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"profile_version_id" uuid,
	"profile_revision" integer,
	"facts" jsonb NOT NULL,
	"facts_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"result_hash" text NOT NULL,
	"ruleset_version" text NOT NULL,
	"as_of_date" date NOT NULL,
	"consent_version" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text NOT NULL,
	"state" text DEFAULT 'not_started' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"due_date" date,
	"date_confirmed" boolean DEFAULT false NOT NULL,
	"assessment_id" uuid,
	"rule_id" text,
	"rule_version" integer,
	"needs_review" boolean DEFAULT false NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "valo_reminder_preferences" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"offsets" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"consent_version" text NOT NULL,
	"actor_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_reminder_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_rule_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"rule" jsonb NOT NULL,
	"publication_bundle" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Reviewed ordering: composite unique indexes MUST exist before referencing FKs.
CREATE UNIQUE INDEX "valo_profile_workspace_id_unique" ON "valo_profile_versions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_assessment_workspace_id_unique" ON "valo_assessments" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_task_workspace_id_unique" ON "valo_tasks" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "valo_assessments" ADD CONSTRAINT "valo_assessments_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_assessments" ADD CONSTRAINT "valo_assessment_profile_tenant_fk" FOREIGN KEY ("workspace_id","profile_version_id") REFERENCES "public"."valo_profile_versions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_tasks" ADD CONSTRAINT "valo_tasks_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_tasks" ADD CONSTRAINT "valo_task_assessment_tenant_fk" FOREIGN KEY ("workspace_id","assessment_id") REFERENCES "public"."valo_assessments"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_reminder_preferences" ADD CONSTRAINT "valo_reminder_preferences_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_reminder_outbox" ADD CONSTRAINT "valo_reminder_outbox_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_reminder_outbox" ADD CONSTRAINT "valo_reminder_task_tenant_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."valo_tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valo_assessment_history_idx" ON "valo_assessments" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "valo_task_workspace_state_idx" ON "valo_tasks" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_reminder_idempotency_unique" ON "valo_reminder_outbox" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "valo_reminder_dispatch_idx" ON "valo_reminder_outbox" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "valo_reminder_workspace_idx" ON "valo_reminder_outbox" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_rule_release_version_unique" ON "valo_rule_releases" USING btree ("rule_id","version");