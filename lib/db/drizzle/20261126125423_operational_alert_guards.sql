-- SEC-008, NFR-010 (docs/architecture/alerts.md, part 1): the journal of the alerts the worker raised and
-- cleared is kept as it was written. No row is changed or removed, the table cannot be emptied, and it keeps
-- a history digest (ADM-009); it is new, so its digest starts empty.
CREATE FUNCTION public.valo_operational_alert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'An operational alert is never changed or removed' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_operational_alert_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_operational_alerts_guard BEFORE UPDATE OR DELETE ON public.valo_operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public.valo_operational_alert_guard();--> statement-breakpoint
CREATE TRIGGER valo_operational_alerts_no_truncate BEFORE TRUNCATE ON public.valo_operational_alerts
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_operational_alerts_digest AFTER INSERT OR UPDATE OR DELETE ON public.valo_operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();
