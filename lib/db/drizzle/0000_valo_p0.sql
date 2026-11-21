CREATE TABLE "valo_workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_identity_id" text NOT NULL,
	"profile_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"identity_id" text NOT NULL,
	"role" text NOT NULL,
	"active" text DEFAULT 'yes' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_profile_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"profile_hash" text NOT NULL,
	"notice_version" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_document_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_support_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category" text NOT NULL,
	"scope" text NOT NULL,
	"contact_email" text NOT NULL,
	"sharing_consent" boolean NOT NULL,
	"consent_version" text NOT NULL,
	"dispatch_status" text DEFAULT 'awaiting_staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "valo_memberships" ADD CONSTRAINT "valo_memberships_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_profile_versions" ADD CONSTRAINT "valo_profile_versions_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_documents" ADD CONSTRAINT "valo_documents_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_document_revisions" ADD CONSTRAINT "valo_document_revisions_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_document_revisions" ADD CONSTRAINT "valo_document_revisions_document_id_valo_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."valo_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_tickets" ADD CONSTRAINT "valo_support_tickets_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_events" ADD CONSTRAINT "valo_events_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_workspace_owner_unique" ON "valo_workspaces" USING btree ("owner_identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_membership_identity_unique" ON "valo_memberships" USING btree ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_profile_revision_unique" ON "valo_profile_versions" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE INDEX "valo_documents_workspace_idx" ON "valo_documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "valo_document_revision_unique" ON "valo_document_revisions" USING btree ("document_id","revision");--> statement-breakpoint
CREATE INDEX "valo_revisions_workspace_idx" ON "valo_document_revisions" USING btree ("workspace_id");