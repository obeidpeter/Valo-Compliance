-- ADM-009 (docs/architecture/audit-trail.md): a workspace's activity history (valo_events) and a privacy case's
-- history (valo_privacy_events) become append-only, and no history table can be emptied with TRUNCATE. The
-- guards bind every login that cannot disable a trigger; the application login owns these tables and still
-- can, which the integrity checks that follow this change detect, and which moving the tables to an owner the
-- application cannot act as later removes.

-- A workspace's activity is never changed. Its rows are removed only by a verified deletion request at its
-- activity step, or by the cleanup of a workspace that belongs to a synthetic test identity.
CREATE FUNCTION public.valo_activity_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (
    EXISTS (SELECT FROM public.valo_privacy_cases c WHERE c.workspace_id = OLD.workspace_id
      AND c.kind = 'deletion' AND c.verified_at IS NOT NULL
      AND c.status IN ('assigned', 'in_progress', 'failed', 'partially_fulfilled')
      AND c.erasure_phase = 'activity_text')
    OR EXISTS (SELECT FROM public.valo_workspaces w WHERE w.id = OLD.workspace_id
      AND (w.owner_identity_id LIKE 'synthetic-%' OR w.owner_identity_id LIKE 'privacy-fixture-%'))
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Workspace activity history is append-only' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_activity_history_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_events_append_only BEFORE UPDATE OR DELETE ON public.valo_events
  FOR EACH ROW EXECUTE FUNCTION public.valo_activity_history_guard();--> statement-breakpoint

-- A privacy case's history is never removed, except with a synthetic test identity's workspace. A row changes
-- only as an erasure replaces its reason with the projection the erasure recorded first, as a refund
-- transition's may (0029).
CREATE FUNCTION public.valo_privacy_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.reason = '[Private content removed by verified workspace erasure]'
    AND (to_jsonb(NEW) - 'reason') = (to_jsonb(OLD) - 'reason')
    AND EXISTS (SELECT FROM public.valo_privacy_redactions r WHERE r.table_name = TG_TABLE_NAME
      AND r.row_id = OLD.id AND r.workspace_id = OLD.workspace_id AND r.projection = to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT FROM public.valo_workspaces w WHERE w.id = OLD.workspace_id
      AND (w.owner_identity_id LIKE 'synthetic-%' OR w.owner_identity_id LIKE 'privacy-fixture-%')) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Privacy case history is append-only' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_privacy_history_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_privacy_events_append_only BEFORE UPDATE OR DELETE ON public.valo_privacy_events
  FOR EACH ROW EXECUTE FUNCTION public.valo_privacy_history_guard();--> statement-breakpoint

-- TRUNCATE fires no row trigger, so each table whose rows the database refuses to delete refuses it as well.
-- Seven tables already did (0036 and later); these are the others.
CREATE TRIGGER valo_events_no_truncate BEFORE TRUNCATE ON public.valo_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_privacy_events_no_truncate BEFORE TRUNCATE ON public.valo_privacy_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_content_versions_no_truncate BEFORE TRUNCATE ON public.valo_content_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_dispute_actions_no_truncate BEFORE TRUNCATE ON public.valo_dispute_actions
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_dispute_transitions_no_truncate BEFORE TRUNCATE ON public.valo_dispute_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_manual_changes_no_truncate BEFORE TRUNCATE ON public.valo_manual_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_manual_hold_lifts_no_truncate BEFORE TRUNCATE ON public.valo_manual_hold_lifts
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_manual_holds_no_truncate BEFORE TRUNCATE ON public.valo_manual_holds
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_manual_library_no_truncate BEFORE TRUNCATE ON public.valo_manual_library
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_manual_regulatory_checks_no_truncate BEFORE TRUNCATE ON public.valo_manual_regulatory_checks
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_manual_reviews_no_truncate BEFORE TRUNCATE ON public.valo_manual_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_manual_withdrawals_no_truncate BEFORE TRUNCATE ON public.valo_manual_withdrawals
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_payment_concern_events_no_truncate BEFORE TRUNCATE ON public.valo_payment_concern_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_prices_no_truncate BEFORE TRUNCATE ON public.valo_prices
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_privacy_erasure_objects_no_truncate BEFORE TRUNCATE ON public.valo_privacy_erasure_objects
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_privacy_redactions_no_truncate BEFORE TRUNCATE ON public.valo_privacy_redactions
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_publication_audit_no_truncate BEFORE TRUNCATE ON public.valo_publication_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_publication_policies_no_truncate BEFORE TRUNCATE ON public.valo_publication_policies
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_refund_transitions_no_truncate BEFORE TRUNCATE ON public.valo_refund_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_rule_releases_no_truncate BEFORE TRUNCATE ON public.valo_rule_releases
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_safety_control_audit_no_truncate BEFORE TRUNCATE ON public.valo_safety_control_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_source_impacts_no_truncate BEFORE TRUNCATE ON public.valo_source_impacts
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_source_register_no_truncate BEFORE TRUNCATE ON public.valo_source_register
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_source_release_bindings_no_truncate BEFORE TRUNCATE ON public.valo_source_release_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_source_review_notes_no_truncate BEFORE TRUNCATE ON public.valo_source_review_notes
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_source_review_preparations_no_truncate BEFORE TRUNCATE ON public.valo_source_review_preparations
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_source_snapshots_no_truncate BEFORE TRUNCATE ON public.valo_source_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_support_actions_no_truncate BEFORE TRUNCATE ON public.valo_support_actions
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_support_events_no_truncate BEFORE TRUNCATE ON public.valo_support_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();
