CREATE TABLE "valo_ai_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"provider_input_hash" text,
	"task" text NOT NULL,
	"status" text NOT NULL,
	"prompt_version" text NOT NULL,
	"budget_reserved" boolean DEFAULT false NOT NULL,
	"preview" jsonb NOT NULL,
	"plan" jsonb,
	"provider_runs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_calls" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"accepted_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_safety_switches" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "valo_document_revisions" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "valo_ai_drafts" ADD CONSTRAINT "valo_ai_drafts_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_ai_drafts" ADD CONSTRAINT "valo_ai_drafts_accepted_document_id_workspace_id_valo_documents_id_workspace_id_fk" FOREIGN KEY ("accepted_document_id","workspace_id") REFERENCES "public"."valo_documents"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_ai_idempotency_unique" ON "valo_ai_drafts" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_ai_workspace_id_unique" ON "valo_ai_drafts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_ai_accepted_document_unique" ON "valo_ai_drafts" USING btree ("accepted_document_id");--> statement-breakpoint
CREATE INDEX "valo_ai_budget_date_idx" ON "valo_ai_drafts" USING btree ("budget_reserved","created_at");--> statement-breakpoint
CREATE INDEX "valo_ai_workspace_date_idx" ON "valo_ai_drafts" USING btree ("workspace_id","created_at");