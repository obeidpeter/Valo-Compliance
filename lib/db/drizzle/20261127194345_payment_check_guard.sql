-- docs/architecture/reconciliation.md, slice 2 (PAY-007): "finance can resolve a discrepancy with an audit
-- trail and without editing financial history directly". A daily payment check is history once it has
-- finished. The guard keeps it so: a waiting check is finished only by the daily check; a finished one is
-- never changed, save that finance settles a difference once, with its reason recorded in the staff
-- access audit in the same transaction, and that an erasure rewrites its finding.
CREATE FUNCTION public.valo_payment_check_kept() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE settled constant text[] := ARRAY['status', 'outcome', 'resolved_by', 'resolved_at'];
BEGIN
  IF (NEW.id, NEW.workspace_id, NEW.order_id, NEW.day, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.workspace_id, OLD.order_id, OLD.day, OLD.created_at) THEN
    RAISE EXCEPTION 'A payment check keeps the order and the day it is about' USING ERRCODE = '23514';
  END IF;
  -- An erasure rewrites a check's finding, and nothing else (valo-private-copy-inventory.ts).
  IF NEW.finding = 'PRIVACY_ERASURE_FINANCE_REVIEW' AND (to_jsonb(NEW) - 'finding') = (to_jsonb(OLD) - 'finding') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending' THEN
    IF NEW.status NOT IN ('pending', 'matched', 'needs_review')
       OR (NEW.outcome, NEW.resolved_by, NEW.resolved_at) IS DISTINCT FROM (OLD.outcome, OLD.resolved_by, OLD.resolved_at) THEN
      RAISE EXCEPTION 'A waiting payment check is finished by the daily check, and is not settled' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'needs_review' AND NEW.status = 'resolved'
     AND (to_jsonb(NEW) - settled) = (to_jsonb(OLD) - settled) THEN
    IF NEW.resolved_at IS DISTINCT FROM now() OR NOT EXISTS (
      SELECT 1 FROM public.valo_staff_access_audit a
      JOIN public.valo_staff_assignments s ON s.id = a.assignment_id
      WHERE a.object = 'payment_check:' || NEW.id::text AND a.area = 'finance'
        AND a.actor_id = NEW.resolved_by AND a.created_at = now()
        AND s.identity_id = NEW.resolved_by AND s.role = 'finance' AND s.active
        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) THEN
      RAISE EXCEPTION 'A payment check is settled only by finance, with the reason recorded as it is settled'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.outcome = 'no_payment_stands' AND EXISTS (
      SELECT 1 FROM public.valo_orders o WHERE o.id = NEW.order_id AND o.status = 'verified_success') THEN
      RAISE EXCEPTION 'An order Valo holds as paid is not settled as having no payment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A finished payment check is never changed, save that finance settles a difference once'
    USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_payment_check_kept() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_payment_checks_kept BEFORE UPDATE ON public.valo_payment_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.valo_payment_check_kept();
