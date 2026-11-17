-- Row-level security for workspace scoping. Customer requests act as valo_workspace_scope
-- with valo.workspace_id set for each transaction (runInWorkspaceScope in lib/db/src/index.ts),
-- and these policies limit that role to the current workspace's rows, so a query that forgets
-- its workspace filter still cannot read or change another workspace's rows. The application
-- role owns the tables, so row security does not apply to it: background work, staff
-- operations and migrations are unchanged.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valo_workspace_scope') THEN
    CREATE ROLE valo_workspace_scope NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valo_workspace_scope'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'valo_workspace_scope already exists with privileges it must not have';
  END IF;
END $$;
--> statement-breakpoint
-- The scoped role gets the application's table privileges, without DDL or TRUNCATE.
GRANT USAGE ON SCHEMA public TO valo_workspace_scope;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO valo_workspace_scope;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO valo_workspace_scope;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO valo_workspace_scope;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO valo_workspace_scope;
--> statement-breakpoint
-- The application role switches to the scoped role inside each customer transaction.
GRANT valo_workspace_scope TO CURRENT_USER;
--> statement-breakpoint
ALTER TABLE "valo_saved_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_privacy_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_privacy_erasure_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_privacy_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_privacy_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_privacy_tombstones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_profile_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_document_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_support_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_support_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_support_escalations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_support_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_support_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_support_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_export_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_export_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_export_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_file_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_correction_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_reminder_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_reminder_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_ai_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_dispute_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_dispute_information" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_dispute_transitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_payment_disputes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_payment_reconciliations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_purchase_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_refund_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_refund_transitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_concern_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_payment_concern_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_payment_concerns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_workspace_export_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_workspace_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_saved_templates" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_saved_templates"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_saved_templates"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_privacy_cases" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_privacy_cases"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_privacy_cases"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_privacy_erasure_objects" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_privacy_erasure_objects"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_privacy_erasure_objects"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_privacy_events" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_privacy_events"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_privacy_events"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_privacy_messages" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_privacy_messages"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_privacy_messages"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_privacy_tombstones" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_privacy_tombstones"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_privacy_tombstones"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_workspaces" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_workspaces"."id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_workspaces"."id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_memberships" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_memberships"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_memberships"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_profile_versions" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_profile_versions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_profile_versions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_documents" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_documents"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_documents"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_document_revisions" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_document_revisions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_document_revisions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_support_actions" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING (exists (select 1 from valo_support_cases c where c.id = "valo_support_actions"."case_id" and c.workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid)) WITH CHECK (exists (select 1 from valo_support_cases c where c.id = "valo_support_actions"."case_id" and c.workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_support_cases" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_support_cases"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_support_cases"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_support_escalations" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING (exists (select 1 from valo_support_cases c where c.id = "valo_support_escalations"."case_id" and c.workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid)) WITH CHECK (exists (select 1 from valo_support_cases c where c.id = "valo_support_escalations"."case_id" and c.workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_support_events" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING (exists (select 1 from valo_support_cases c where c.id = "valo_support_events"."case_id" and c.workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid)) WITH CHECK (exists (select 1 from valo_support_cases c where c.id = "valo_support_events"."case_id" and c.workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_support_messages" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_support_messages"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_support_messages"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_support_tickets" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_support_tickets"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_support_tickets"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_events" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_events"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_events"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_export_jobs" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_export_jobs"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_export_jobs"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_export_objects" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_export_objects"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_export_objects"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_export_requests" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_export_requests"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_export_requests"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_file_assets" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_file_assets"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_file_assets"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_correction_notices" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_correction_notices"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_correction_notices"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_assessments" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_assessments"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_assessments"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_tasks" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_tasks"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_tasks"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_reminder_preferences" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_reminder_preferences"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_reminder_preferences"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_reminder_outbox" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_reminder_outbox"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_reminder_outbox"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_ai_drafts" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_ai_drafts"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_ai_drafts"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_dispute_actions" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_dispute_actions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_dispute_actions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_dispute_information" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_dispute_information"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_dispute_information"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_dispute_transitions" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_dispute_transitions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_dispute_transitions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_entitlements" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_entitlements"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_entitlements"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_orders" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_orders"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_orders"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_payment_disputes" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_payment_disputes"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_payment_disputes"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_payment_reconciliations" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_payment_reconciliations"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_payment_reconciliations"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_purchase_outbox" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_purchase_outbox"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_purchase_outbox"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_refund_requests" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_refund_requests"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_refund_requests"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_refund_transitions" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_refund_transitions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_refund_transitions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_concern_messages" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_concern_messages"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_concern_messages"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_payment_concern_events" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_payment_concern_events"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_payment_concern_events"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_payment_concerns" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_payment_concerns"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_payment_concerns"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_workspace_export_attempts" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_workspace_export_attempts"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_workspace_export_attempts"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_workspace_exports" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_workspace_exports"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_workspace_exports"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- valo_privacy_redactions is written only by raw SQL, so its policy is not in the Drizzle schema.
ALTER TABLE "valo_privacy_redactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_privacy_redactions" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_privacy_redactions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid) WITH CHECK ("valo_privacy_redactions"."workspace_id" = nullif(current_setting('valo.workspace_id', true), '')::uuid);
