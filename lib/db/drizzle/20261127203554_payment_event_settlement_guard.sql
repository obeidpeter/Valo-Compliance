-- docs/architecture/reconciliation.md, slice 3a (PAY-007): "finance can resolve a discrepancy with an audit
-- trail and without editing financial history directly". A provider event Valo could not match or process
-- is settled by a row of its own; the event itself is never changed for it. The guard takes a settlement
-- only of an event that needs review, with the finding it has, from finance, with its reason recorded in the
-- staff access audit in the same transaction, and never changes or removes one. The settlements are a
-- history, so they keep a history digest (ADM-009, docs/architecture/audit-trail.md); it starts from the rows
-- the table holds when the guard is added.
CREATE FUNCTION public.valo_payment_event_settlement_kept() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'A settlement of a payment event is never changed or removed' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.valo_payment_events e
    WHERE e.id = NEW.event_id AND e.status = 'needs_review' AND coalesce(e.failure, '') = NEW.finding) THEN
    RAISE EXCEPTION 'A payment event is settled only while it needs review, with the finding it has'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.resolved_at IS DISTINCT FROM now() OR NOT EXISTS (
    SELECT 1 FROM public.valo_staff_access_audit a
    JOIN public.valo_staff_assignments s ON s.id = a.assignment_id
    WHERE a.object = 'payment_event:' || NEW.event_id::text AND a.area = 'finance'
      AND a.actor_id = NEW.resolved_by AND a.created_at = now()
      AND s.identity_id = NEW.resolved_by AND s.role = 'finance' AND s.active
      AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'A payment event is settled only by finance, with the reason recorded as it is settled'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_payment_event_settlement_kept() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_payment_event_settlements_kept
  BEFORE INSERT OR UPDATE OR DELETE ON public.valo_payment_event_settlements
  FOR EACH ROW EXECUTE FUNCTION public.valo_payment_event_settlement_kept();--> statement-breakpoint
CREATE TRIGGER valo_payment_event_settlements_no_truncate BEFORE TRUNCATE ON public.valo_payment_event_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_payment_event_settlements_digest
  AFTER INSERT OR UPDATE OR DELETE ON public.valo_payment_event_settlements
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();--> statement-breakpoint
SELECT public.valo_history_digest_reseed('public.valo_payment_event_settlements');
