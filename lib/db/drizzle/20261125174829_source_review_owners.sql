CREATE TABLE "valo_source_review_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"note" text NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_source_review_notes_note" CHECK (length("valo_source_review_notes"."note") BETWEEN 20 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "valo_source_review_work" DROP CONSTRAINT "valo_source_review_work_status_check";--> statement-breakpoint
ALTER TABLE "valo_source_review_notes" ADD CONSTRAINT "valo_source_review_notes_work_id_valo_source_review_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."valo_source_review_work"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valo_source_review_notes_work" ON "valo_source_review_notes" USING btree ("work_id","created_at");--> statement-breakpoint
ALTER TABLE "valo_source_review_work" ADD CONSTRAINT "valo_source_review_work_status_check" CHECK ("valo_source_review_work"."status" IN ('awaiting_authorized_review', 'superseded_by_eligible_version', 'withdrawn'));--> statement-breakpoint
-- What was checked on review work (docs/architecture/source-register.md, slice 3). A note is recorded on an
-- open row, by an active Content editor or the development owner, dated by the database, and never changed
-- or removed.
CREATE FUNCTION public.valo_guard_source_review_note() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A review note is never changed or removed'; END IF;
  IF NOT EXISTS (SELECT FROM public.valo_source_review_work
                 WHERE id = NEW.work_id AND status = 'awaiting_authorized_review') THEN
    RAISE EXCEPTION 'A review note is recorded only on open review work';
  END IF;
  IF NOT EXISTS (SELECT FROM public.valo_staff_assignments WHERE identity_id = NEW.recorded_by AND role = 'content'
                 AND active AND (expires_at IS NULL OR expires_at > clock_timestamp()))
     AND NOT public.valo_manual_regulatory_owner(NEW.recorded_by) THEN
    RAISE EXCEPTION 'An active content editor or the development owner is required';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_source_review_note() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_guard_source_review_note BEFORE INSERT OR UPDATE OR DELETE ON public.valo_source_review_notes
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_source_review_note();--> statement-breakpoint
-- Review work still open on a withdrawn version closes now as withdrawn: a version whose status is
-- withdrawn, or one a withdrawal holds.
UPDATE public.valo_source_review_work w SET status = 'withdrawn', completed_at = now()
FROM public.valo_source_impacts i
WHERE w.impact_id = i.id AND w.status = 'awaiting_authorized_review' AND (
  EXISTS (SELECT FROM public.valo_source_impacts x
          WHERE x.target_kind = i.target_kind AND x.target_id = i.target_id AND x.action = 'withdraw')
  OR (i.target_kind = 'content' AND EXISTS (SELECT FROM public.valo_content_versions c
                                            WHERE c.id = i.target_id AND c.status = 'withdrawn'))
  OR (i.target_kind = 'rule' AND EXISTS (SELECT FROM public.valo_rule_releases r
                                         WHERE r.id = i.target_id AND r.status = 'withdrawn')));--> statement-breakpoint
-- Review work still open on a rule version a later release replaced closes now, naming the rule's
-- release in force where there is one.
UPDATE public.valo_source_review_work w SET status = 'superseded_by_eligible_version', replacement_kind = 'rule',
  replacement_id = (SELECT n.id FROM public.valo_rule_releases n
                    WHERE n.rule_id = i.target_key AND n.status = 'published' ORDER BY n.version DESC LIMIT 1),
  completed_at = now()
FROM public.valo_source_impacts i
WHERE w.impact_id = i.id AND w.status = 'awaiting_authorized_review' AND i.target_kind = 'rule'
  AND EXISTS (SELECT FROM public.valo_rule_releases r WHERE r.id = i.target_id AND r.status = 'superseded');
