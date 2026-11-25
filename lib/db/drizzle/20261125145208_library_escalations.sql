ALTER TABLE "valo_support_escalations" DROP CONSTRAINT "valo_support_escalations_target_kind_check";--> statement-breakpoint
ALTER TABLE "valo_support_escalations" ADD COLUMN "library_hold_id" uuid;--> statement-breakpoint
ALTER TABLE "valo_support_escalations" ADD CONSTRAINT "valo_support_escalation_library_hold_fk" FOREIGN KEY ("library_hold_id") REFERENCES "public"."valo_manual_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_support_escalations" ADD CONSTRAINT "valo_support_escalation_hold_kind" CHECK (("valo_support_escalations"."library_hold_id" IS NULL OR "valo_support_escalations"."target_kind" = 'library') AND ("valo_support_escalations"."source_impact_id" IS NULL OR "valo_support_escalations"."target_kind" <> 'library'));--> statement-breakpoint
ALTER TABLE "valo_support_escalations" ADD CONSTRAINT "valo_support_escalations_target_kind_check" CHECK ("valo_support_escalations"."target_kind" IN ('content','rule','library'));--> statement-breakpoint
-- A referral keeps the exact version it points at, and its staff-library hold is set once, to a hold
-- placed on that edition (docs/architecture/library-holds.md, slice 3). A privacy erasure may still
-- replace its reason.
CREATE FUNCTION public.valo_guard_escalation_library_hold() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.target_kind, NEW.target_id, NEW.target_hash, NEW.target_version)
       IS DISTINCT FROM (OLD.target_kind, OLD.target_id, OLD.target_hash, OLD.target_version) THEN
    RAISE EXCEPTION 'A referral keeps the version it points at';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.library_hold_id IS NOT NULL
     AND NEW.library_hold_id IS DISTINCT FROM OLD.library_hold_id THEN
    RAISE EXCEPTION 'A referral keeps the hold it placed';
  END IF;
  IF NEW.library_hold_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.library_hold_id IS NULL)
     AND NOT EXISTS (SELECT FROM public.valo_manual_holds h
                     WHERE h.id = NEW.library_hold_id AND h.edition = NEW.target_id) THEN
    RAISE EXCEPTION 'A referral is held only by a hold on the version it points at';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_escalation_library_hold() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_escalation_library_hold BEFORE INSERT OR UPDATE ON public.valo_support_escalations
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_escalation_library_hold();
