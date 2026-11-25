ALTER TABLE "valo_source_watches" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
-- The source register stops a retired source's daily check and restarts it when the source is brought
-- back (docs/architecture/source-register.md, slice 2). A version bound to a stopped watch fails the
-- source gate, and the application holds what rests on the source in the same transaction. A watch
-- started later for a retired source starts stopped.
CREATE FUNCTION public.valo_source_register_watch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE previous text;
BEGIN
  SELECT status INTO previous FROM public.valo_source_register
    WHERE source_id = NEW.source_id AND version = NEW.version - 1;
  IF NEW.status = 'retired' THEN
    UPDATE public.valo_source_watches SET stopped_at = clock_timestamp()
      WHERE source_id = NEW.source_id AND stopped_at IS NULL;
  ELSIF previous = 'retired' THEN
    UPDATE public.valo_source_watches SET stopped_at = NULL, next_check_at = clock_timestamp()
      WHERE source_id = NEW.source_id AND stopped_at IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_source_register_watch() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_source_register_watch AFTER INSERT ON public.valo_source_register
FOR EACH ROW EXECUTE FUNCTION public.valo_source_register_watch();--> statement-breakpoint
-- A source the register retired before this migration stops being checked now. The gate refuses what
-- rests on it at once, and the daily sweep of overdue sources holds it.
UPDATE public.valo_source_watches w SET stopped_at = clock_timestamp()
WHERE w.stopped_at IS NULL AND (SELECT r.status FROM public.valo_source_register r
  WHERE r.source_id = w.source_id ORDER BY r.version DESC LIMIT 1) = 'retired';
