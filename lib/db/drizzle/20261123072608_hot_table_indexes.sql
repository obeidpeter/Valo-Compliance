CREATE INDEX "valo_events_workspace_entity_action_idx" ON "valo_events" USING btree ("workspace_id","entity_id","action","created_at");--> statement-breakpoint
CREATE INDEX "valo_events_workspace_created_idx" ON "valo_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "valo_export_workspace_document_idx" ON "valo_export_jobs" USING btree ("workspace_id","document_id","created_at");--> statement-breakpoint
CREATE INDEX "valo_file_assets_workspace_created_idx" ON "valo_file_assets" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "valo_file_assets_retention_idx" ON "valo_file_assets" USING btree ("retention_at");--> statement-breakpoint
CREATE INDEX "valo_concern_events_concern_visible_idx" ON "valo_payment_concern_events" USING btree ("concern_id","customer_visible","created_at");--> statement-breakpoint
CREATE INDEX "valo_dispute_workspace_order_idx" ON "valo_payment_disputes" USING btree ("workspace_id","order_id","checked_at");--> statement-breakpoint
CREATE INDEX "valo_refund_workspace_order_idx" ON "valo_refund_requests" USING btree ("workspace_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "valo_support_case_workspace_updated_idx" ON "valo_support_cases" USING btree ("workspace_id","updated_at");