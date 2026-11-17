-- Row-level security for workspace scoping. Customer requests act as valo_workspace_scope
-- with valo.workspace_id set for each transaction (runInWorkspaceScope in lib/db/src/index.ts),
-- and these policies limit that role to the current workspace's rows, so a query that forgets
-- its workspace filter still cannot read or change another workspace's rows. The role may run
-- only the commands customer requests use, table by table (WORKSPACE_SCOPE_PRIVILEGES in
-- lib/db/scripts/workspace-row-security.mjs); tables created later give it nothing until a
-- migration grants it. The application role owns the tables, so row security does not apply
-- to it: background work, staff operations and migrations are unchanged.
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
GRANT USAGE ON SCHEMA public TO valo_workspace_scope;
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
--> statement-breakpoint
-- A payment event belongs to the workspace whose order, refund or dispute it references.
ALTER TABLE "valo_payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_payment_events" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_payment_events"."reference" in (select reference from valo_orders where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid union select provider_transaction_id from valo_orders where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid union select reference from valo_refund_requests where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid union select provider_id from valo_refund_requests where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid union select provider_id from valo_payment_disputes where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid)) WITH CHECK ("valo_payment_events"."reference" in (select reference from valo_orders where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid union select provider_transaction_id from valo_orders where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid union select reference from valo_refund_requests where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid union select provider_id from valo_refund_requests where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid union select provider_id from valo_payment_disputes where workspace_id = nullif(current_setting('valo.workspace_id', true), '')::uuid));
--> statement-breakpoint
-- What customer requests may do, table by table. Every other table is refused.
GRANT SELECT, INSERT, UPDATE ON valo_ai_drafts TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_assessments TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_concern_messages TO valo_workspace_scope;
GRANT SELECT, UPDATE ON valo_content_versions TO valo_workspace_scope;
GRANT SELECT ON valo_correction_notices TO valo_workspace_scope;
GRANT SELECT ON valo_dispute_actions TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_dispute_information TO valo_workspace_scope;
GRANT SELECT ON valo_dispute_transitions TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_document_revisions TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_documents TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_entitlements TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_events TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_export_jobs TO valo_workspace_scope;
GRANT SELECT, UPDATE ON valo_export_objects TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_export_requests TO valo_workspace_scope;
GRANT SELECT, DELETE, UPDATE ON valo_file_assets TO valo_workspace_scope;
GRANT SELECT, UPDATE ON valo_inference_batches TO valo_workspace_scope;
GRANT SELECT, UPDATE ON valo_memberships TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_orders TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_payment_concern_events TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_payment_concerns TO valo_workspace_scope;
GRANT SELECT ON valo_payment_disputes TO valo_workspace_scope;
GRANT SELECT ON valo_payment_events TO valo_workspace_scope;
GRANT SELECT ON valo_payment_reconciliations TO valo_workspace_scope;
GRANT SELECT, UPDATE ON valo_prices TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_privacy_cases TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_privacy_events TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_privacy_key_versions TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_privacy_messages TO valo_workspace_scope;
GRANT SELECT ON valo_privacy_redactions TO valo_workspace_scope;
GRANT SELECT ON valo_privacy_tombstones TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_profile_versions TO valo_workspace_scope;
GRANT SELECT ON valo_publication_policies TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_purchase_outbox TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_rate_buckets TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_refund_requests TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_refund_transitions TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_reminder_outbox TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_reminder_preferences TO valo_workspace_scope;
GRANT SELECT ON valo_rule_releases TO valo_workspace_scope;
GRANT SELECT ON valo_safety_switches TO valo_workspace_scope;
GRANT SELECT, INSERT, DELETE ON valo_saved_templates TO valo_workspace_scope;
GRANT SELECT ON valo_source_impacts TO valo_workspace_scope;
GRANT SELECT ON valo_source_release_bindings TO valo_workspace_scope;
GRANT SELECT ON valo_source_watches TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_support_actions TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_support_cases TO valo_workspace_scope;
GRANT SELECT ON valo_support_escalations TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_support_events TO valo_workspace_scope;
GRANT SELECT, INSERT ON valo_support_messages TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_support_tickets TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_tasks TO valo_workspace_scope;
GRANT SELECT, UPDATE ON valo_workspace_export_attempts TO valo_workspace_scope;
GRANT SELECT, INSERT, UPDATE ON valo_workspace_exports TO valo_workspace_scope;
GRANT SELECT, UPDATE (profile_revision) ON valo_workspaces TO valo_workspace_scope;
--> statement-breakpoint
-- PostgreSQL lets a role lock rows (SELECT ... FOR SHARE or FOR UPDATE) only if it may update
-- them. Customer requests lock rows of these tables but never change them, so this trigger
-- refuses every update the scoped role attempts, and its UPDATE grant permits only the locks.
CREATE FUNCTION valo_refuse_scoped_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'valo_workspace_scope' THEN
    RAISE EXCEPTION 'valo_workspace_scope may lock rows of % but not change them', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER valo_workspace_scope_lock_only BEFORE UPDATE ON valo_content_versions FOR EACH ROW EXECUTE FUNCTION valo_refuse_scoped_update();
CREATE TRIGGER valo_workspace_scope_lock_only BEFORE UPDATE ON valo_file_assets FOR EACH ROW EXECUTE FUNCTION valo_refuse_scoped_update();
CREATE TRIGGER valo_workspace_scope_lock_only BEFORE UPDATE ON valo_inference_batches FOR EACH ROW EXECUTE FUNCTION valo_refuse_scoped_update();
CREATE TRIGGER valo_workspace_scope_lock_only BEFORE UPDATE ON valo_memberships FOR EACH ROW EXECUTE FUNCTION valo_refuse_scoped_update();
CREATE TRIGGER valo_workspace_scope_lock_only BEFORE UPDATE ON valo_prices FOR EACH ROW EXECUTE FUNCTION valo_refuse_scoped_update();
CREATE TRIGGER valo_workspace_scope_lock_only BEFORE UPDATE ON valo_support_tickets FOR EACH ROW EXECUTE FUNCTION valo_refuse_scoped_update();
--> statement-breakpoint
-- Customer AI limits count every workspace's reservations: the shared daily ceiling and each
-- person's per-minute limit. Row security shows customer requests only their own workspace's
-- drafts, so this function counts them as its owner and returns nothing but the two totals.
CREATE FUNCTION valo_customer_ai_reservations(day_start timestamptz, minute_start timestamptz, identity_id text)
RETURNS TABLE (global_today integer, identity_last_minute integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT count(*) FILTER (WHERE d.created_at >= day_start)::integer,
    count(*) FILTER (WHERE d.actor_id = identity_id AND d.created_at >= minute_start)::integer
  FROM public.valo_ai_drafts d
  WHERE d.budget_reserved AND d.created_at >= least(day_start, minute_start)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_customer_ai_reservations(timestamptz, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION valo_customer_ai_reservations(timestamptz, timestamptz, text) TO valo_workspace_scope;
--> statement-breakpoint
-- The shared inference ledger is written only through the next four functions, which run as
-- their owner, so the scoped role needs no write privilege on it. A customer request may make
-- only the changes a customer AI attempt makes; other callers keep their own checks.
CREATE FUNCTION public.valo_inference_customer_change_refusal(p_id text, p_old jsonb, p_new jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  o jsonb;
  n jsonb;
  receipt text[] := ARRAY['status', 'charged', 'responseId', 'resultRef', 'freshUntil', 'usageHash'];
  input_bound numeric;
  spent_before numeric;
  spent_after numeric;
BEGIN
  -- Customer AI uses only the additional allocation, and the cap and prices below are its own.
  IF p_id IS DISTINCT FROM 'valo-additional-inference-30-20261114-v1' THEN
    RETURN 'another allocation';
  END IF;
  IF p_new - ARRAY['version', 'entries', 'priorUseReconciled', 'unboundedPrior', 'suspended',
      'historyResolutions'] <> '{}'::jsonb THEN
    RETURN 'an unknown state field';
  END IF;
  -- Holds only tighten.
  IF (p_old->>'suspended')::boolean AND NOT (p_new->>'suspended')::boolean THEN
    RETURN 'lifting the suspension';
  END IF;
  IF NOT (p_old->>'priorUseReconciled')::boolean AND (p_new->>'priorUseReconciled')::boolean THEN
    RETURN 'marking prior use reconciled';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_old->'unboundedPrior') x
      WHERE NOT (p_new->'unboundedPrior') @> jsonb_build_array(x)) THEN
    RETURN 'removing an unbounded liability';
  END IF;
  IF p_old->'historyResolutions' IS DISTINCT FROM p_new->'historyResolutions' THEN
    RETURN 'changing history resolutions';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_new->'entries') e
      WHERE jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'runKey') IS DISTINCT FROM 'string'
        OR e->>'runKey' = '' OR coalesce(e->>'reserved', '') !~ '^[0-9]{1,30}$'
        OR coalesce(e->>'charged', '') !~ '^[0-9]{1,30}$'
        OR coalesce(e->>'status', '') NOT IN ('reserved', 'dispatched', 'unknown', 'settled', 'cancelled')) THEN
    RETURN 'an invalid entry';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_new->'entries') e
      GROUP BY e->>'runKey' HAVING count(*) > 1) THEN
    RETURN 'a repeated run key';
  END IF;
  -- Every existing entry stays with its identity, and its status only moves forward.
  FOR o IN SELECT x FROM jsonb_array_elements(p_old->'entries') x LOOP
    n := (SELECT e FROM jsonb_array_elements(p_new->'entries') e WHERE e->>'runKey' = o->>'runKey');
    IF n IS NULL THEN
      RETURN 'removing an entry';
    END IF;
    CONTINUE WHEN n = o;
    IF (n - receipt - 'reserved') IS DISTINCT FROM (o - receipt - 'reserved') THEN
      RETURN 'changing an entry''s identity or bounds';
    END IF;
    IF o->>'status' = 'reserved' AND n->>'status' = 'dispatched' THEN
      IF (n - 'status') IS DISTINCT FROM (o - 'status') THEN
        RETURN 'changing more than the status on dispatch';
      END IF;
    ELSIF o->>'status' IN ('reserved', 'dispatched', 'unknown') AND n->>'status' = 'unknown' THEN
      IF (n - 'status' - 'reserved') IS DISTINCT FROM (o - 'status' - 'reserved')
          OR (n->>'reserved')::numeric < (o->>'reserved')::numeric THEN
        RETURN 'changing more than the status and a raised reservation';
      END IF;
    ELSIF o->>'status' IN ('dispatched', 'unknown') AND n->>'status' = 'settled' THEN
      IF (n - receipt) IS DISTINCT FROM (o - receipt) OR coalesce((o->>'charged')::numeric, -1) <> 0
          OR (n->>'charged')::numeric > (n->>'reserved')::numeric
          OR coalesce(n->>'responseId', '') = '' OR coalesce(n->>'resultRef', '') = ''
          OR coalesce(n->>'usageHash', '') = '' THEN
        RETURN 'a settlement outside its reservation or without a receipt';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_new->'entries') x
          WHERE x->>'runKey' <> n->>'runKey' AND x->>'responseId' = n->>'responseId') THEN
        RETURN 'using a provider receipt twice';
      END IF;
    ELSE
      RETURN format('moving an entry from %s to %s', o->>'status', n->>'status');
    END IF;
  END LOOP;
  -- New entries are customer reservations, funded for their worst case at the current prices.
  FOR n IN SELECT e FROM jsonb_array_elements(p_new->'entries') e
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_old->'entries') x
        WHERE x->>'runKey' = e->>'runKey') LOOP
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(n) k) IS DISTINCT FROM
        ARRAY['bindingHash', 'charged', 'inputBound', 'lane', 'outputBound', 'requestHash', 'reserved',
          'runKey', 'scopeHash', 'status']
        OR n->>'lane' IS DISTINCT FROM 'customer' OR n->>'status' NOT IN ('reserved', 'dispatched')
        OR n->>'charged' <> '0' OR n->'outputBound' IS DISTINCT FROM '8192'::jsonb
        OR jsonb_typeof(n->'inputBound') IS DISTINCT FROM 'number'
        OR coalesce(n->>'requestHash', '') !~ '^[a-f0-9]{64}$'
        OR coalesce(n->>'bindingHash', '') !~ '^[a-f0-9]{64}$'
        OR coalesce(n->>'scopeHash', '') !~ '^[a-f0-9]{64}$' THEN
      RETURN 'a new entry that is not a customer reservation';
    END IF;
    input_bound := (n->>'inputBound')::numeric;
    IF input_bound <> trunc(input_bound) OR input_bound < 4096 OR input_bound > 400000
        OR (n->>'reserved')::numeric < ceil((input_bound * 750 + 8192 * 4500) * 11000 / 10000) THEN
      RETURN 'an underfunded reservation';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_new->'entries') e
        WHERE e->>'lane' = 'customer' AND e->>'status' <> 'cancelled')
      > greatest(94, (SELECT count(*) FROM jsonb_array_elements(p_old->'entries') e
        WHERE e->>'lane' = 'customer' AND e->>'status' <> 'cancelled')) THEN
    RETURN 'exceeding the customer lane''s slots';
  END IF;
  -- Committed spend never rises above the allocation's cap.
  SELECT coalesce(sum(CASE e->>'status' WHEN 'settled' THEN (e->>'charged')::numeric
      WHEN 'cancelled' THEN 0 ELSE (e->>'reserved')::numeric END), 0)
    INTO spent_before FROM jsonb_array_elements(p_old->'entries') e;
  SELECT coalesce(sum(CASE e->>'status' WHEN 'settled' THEN (e->>'charged')::numeric
      WHEN 'cancelled' THEN 0 ELSE (e->>'reserved')::numeric END), 0)
    INTO spent_after FROM jsonb_array_elements(p_new->'entries') e;
  IF spent_after > spent_before AND spent_after > 30000000000 THEN
    RETURN 'exceeding the allocation cap';
  END IF;
  -- At most two attempts are with the provider or unresolved when another is sent.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_new->'entries') e
        WHERE e->>'status' = 'dispatched' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_old->'entries') x
          WHERE x->>'runKey' = e->>'runKey' AND x->>'status' = 'dispatched'))
      AND (SELECT count(*) FROM jsonb_array_elements(p_new->'entries') e
        WHERE NOT coalesce((e->>'legacy')::boolean, false) AND e->>'status' IN ('dispatched', 'unknown')) > 2 THEN
    RETURN 'exceeding the dispatch concurrency';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.valo_inference_budget_lock(p_id text, p_policy_hash text)
RETURNS TABLE (state jsonb, version integer, policy_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  initial jsonb := CASE p_id
    WHEN 'valo-additional-inference-30-20261114-v1' THEN
      '{"version":1,"entries":[],"priorUseReconciled":true,"unboundedPrior":[],"suspended":false}'::jsonb
    WHEN 'valo-managed-inference-30-v1' THEN
      '{"version":1,"entries":[],"priorUseReconciled":false,"unboundedPrior":[],"suspended":false}'::jsonb
  END;
BEGIN
  IF coalesce(current_setting('role', true) = 'valo_workspace_scope', false)
      AND p_id IS DISTINCT FROM 'valo-additional-inference-30-20261114-v1' THEN
    RAISE EXCEPTION 'valo_workspace_scope may use only the customer inference allocation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF initial IS NULL OR coalesce(p_policy_hash, '') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INFERENCE_ALLOCATION_UNKNOWN' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.valo_inference_budgets AS b (id, policy_hash, state)
    VALUES (p_id, p_policy_hash, initial) ON CONFLICT (id) DO NOTHING;
  RETURN QUERY SELECT b.state, b.version, b.policy_hash
    FROM public.valo_inference_budgets b WHERE b.id = p_id FOR UPDATE;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.valo_inference_budget_commit(p_id text, p_version integer, p_state jsonb,
  p_action text, p_before_hash text, p_after_hash text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  old_state jsonb;
  old_version integer;
  refusal text;
BEGIN
  IF coalesce(length(p_action), 0) NOT BETWEEN 1 AND 300
      OR coalesce(p_before_hash, '') !~ '^[a-f0-9]{64}$' OR coalesce(p_after_hash, '') !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(p_state) IS DISTINCT FROM 'object'
      OR p_state->'version' IS DISTINCT FROM '1'::jsonb
      OR jsonb_typeof(p_state->'entries') IS DISTINCT FROM 'array'
      OR jsonb_typeof(p_state->'unboundedPrior') IS DISTINCT FROM 'array'
      OR jsonb_typeof(p_state->'priorUseReconciled') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(p_state->'suspended') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'INVALID_BUDGET_COMMIT' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT b.state, b.version INTO old_state, old_version
    FROM public.valo_inference_budgets b WHERE b.id = p_id FOR UPDATE;
  IF NOT FOUND OR old_version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'INFERENCE_LEDGER_VERSION_CONFLICT';
  END IF;
  IF coalesce(current_setting('role', true) = 'valo_workspace_scope', false) THEN
    refusal := public.valo_inference_customer_change_refusal(p_id, old_state, p_state);
    IF refusal IS NOT NULL THEN
      RAISE EXCEPTION 'valo_workspace_scope may not commit an inference ledger change %', refusal
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  UPDATE public.valo_inference_budgets
    SET state = p_state, version = p_version + 1, updated_at = now() WHERE id = p_id;
  INSERT INTO public.valo_inference_budget_events (budget_id, version, action, before_hash, after_hash)
    VALUES (p_id, p_version + 1, p_action, p_before_hash, p_after_hash);
  RETURN p_version + 1;
END $$;
--> statement-breakpoint
-- A provider result is recorded once, for a work key of the batch's approved manifest; a
-- customer request may record only customer work.
CREATE FUNCTION public.valo_inference_batch_record_result(p_id text, p_key text, p_result jsonb,
  p_manifest_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  customer_only boolean := coalesce(current_setting('role', true) = 'valo_workspace_scope', false);
BEGIN
  UPDATE public.valo_inference_batches b SET results = jsonb_set(b.results, ARRAY[p_key], p_result)
    WHERE b.id = p_id AND b.manifest_hash = p_manifest_hash
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.manifest->'works') w
        WHERE w->>'key' = p_key AND (NOT customer_only OR w->>'lane' = 'customer'))
      AND (NOT b.results ? p_key OR b.results->p_key = p_result);
  RETURN FOUND;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_inference_customer_change_refusal(text, jsonb, jsonb),
  public.valo_inference_budget_lock(text, text),
  public.valo_inference_budget_commit(text, integer, jsonb, text, text, text),
  public.valo_inference_batch_record_result(text, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_inference_budget_lock(text, text),
  public.valo_inference_budget_commit(text, integer, jsonb, text, text, text),
  public.valo_inference_batch_record_result(text, text, jsonb, text) TO valo_workspace_scope;
