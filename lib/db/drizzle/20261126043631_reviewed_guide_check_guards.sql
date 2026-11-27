-- docs/architecture/reviewed-route.md, part 2; decision 0018: a guide that says what the law requires is
-- released only after the development owner's own check of its official sources. On the reviewed route,
-- that check is a row of valo_reviewed_guide_checks (migration reviewed_guide_checks): the owner checked
-- that exact prepared candidate's sources, through the captures it names. A guide's reviews are admitted,
-- and the guide released, only on such a check made within the last day.
--
-- A check is recorded only for the development owner, at the time the database gives it, and is never
-- changed or removed. The table cannot be emptied, and it keeps a history digest; it is new, so its digest
-- starts empty. The customer role has no privilege on it.
CREATE FUNCTION public.valo_reviewed_guide_check_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'An owner''s source check is never changed or removed' USING ERRCODE = '23514';
  END IF;
  IF NOT public.valo_manual_regulatory_owner(NEW.checked_by) THEN
    RAISE EXCEPTION 'Only the development owner checks a guide''s sources for its release' USING ERRCODE = '42501';
  END IF;
  NEW.checked_at := clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_reviewed_guide_check_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_reviewed_guide_checks_guard BEFORE INSERT OR UPDATE OR DELETE ON public.valo_reviewed_guide_checks
  FOR EACH ROW EXECUTE FUNCTION public.valo_reviewed_guide_check_guard();--> statement-breakpoint
CREATE TRIGGER valo_reviewed_guide_checks_no_truncate BEFORE TRUNCATE ON public.valo_reviewed_guide_checks
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint
CREATE TRIGGER valo_reviewed_guide_checks_digest AFTER INSERT OR UPDATE OR DELETE ON public.valo_reviewed_guide_checks
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();--> statement-breakpoint
-- Whether the development owner checked this exact candidate's sources, through these captures, within the
-- last day: the version and candidate are the prepared candidate's, and the captures are the ones its
-- attestations bind. The admission of a guide's reviews, the publisher and the release trigger below ask
-- it. It runs as its owner, so the publisher's role reads no check and no staff record itself. The person
-- who checked must still be the development owner, as the operator's bootstrap granted it (decision 0018).
CREATE FUNCTION public.valo_reviewed_guide_checked(wanted_version uuid, wanted_candidate text, wanted_captures jsonb)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT FROM public.valo_reviewed_guide_checks k
     WHERE k.version_id = wanted_version AND k.candidate_hash = wanted_candidate
       AND k.captures = wanted_captures
       AND k.checked_at <= clock_timestamp() AND k.checked_at > clock_timestamp() - interval '1 day'
       AND EXISTS (
         SELECT FROM public.valo_staff_assignments a
           JOIN public.valo_staff_role_changes c
             ON c.assignment_id = a.id AND c.actor_assignment_id = a.id AND c.target_identity_id = a.identity_id
          WHERE a.identity_id = k.checked_by AND a.role = 'system' AND a.active AND a.grant_mode = 'permanent'
            AND a.expires_at IS NULL AND c.action = 'grant' AND c.role = 'system'
            AND c.actor_id LIKE 'operator-bootstrap:%'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_reviewed_guide_checked(uuid, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_reviewed_guide_checked(uuid, text, jsonb) TO valo_content_publisher_dev;--> statement-breakpoint
-- A guide on the reviewed route became published only by a hold placed on every one (migration
-- manual_library), since this route had no owner's check. It is now published only with the owner's check
-- of its exact candidate and captures, made within the last day. Everything else is as before.
CREATE OR REPLACE FUNCTION public.valo_hold_new_regulatory_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.bundle #>> '{candidate,contentClass}' = 'sourced_guidance' THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Owner source check required for regulatory articles'; END IF;
    IF OLD.status <> 'published' AND NOT public.valo_reviewed_guide_checked(
         NEW.id, NEW.candidate_hash, NEW.attestations -> 'sourceSnapshots') THEN
      RAISE EXCEPTION 'Owner source check required: the development owner''s check of this exact guide''s sources, made within the last day'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
