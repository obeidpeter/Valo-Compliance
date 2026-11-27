-- A login for review alone (docs/architecture/service-logins.md, part 2; SEC-006). Custom SQL:
-- roles, grants, functions and triggers are hand-written.
--
-- Until now an AI review's attempt was recorded on the application's own login, which owns the tables,
-- so anything holding its connection string, the API included, could record a review's attempt or
-- change one, and the drafting login could too once it switched roles. From this migration a review's
-- attempt (role factual or challenge) is recorded and updated only in a session that logged in as
-- valo_reviewer_login, and a drafting attempt (role draft) only in one that logged in as
-- valo_drafter_login. No attempt is ever removed and the table cannot be emptied, so it is a history and
-- keeps a digest (ADM-009), which starts from the attempts it holds now. The review login may become the
-- reviewer role and nothing else, and holds nothing of its own (NOINHERIT).
DO $$
BEGIN
  -- Created without login; each environment gives it a password and stores the connection string
  -- as VALO_REVIEWER_DATABASE_URL (lib/db/scripts/reviewer-login.mjs).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valo_reviewer_login') THEN
    CREATE ROLE valo_reviewer_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valo_reviewer_login'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
    RAISE EXCEPTION 'valo_reviewer_login already exists with privileges it must not have';
  END IF;
END $$;
--> statement-breakpoint
GRANT valo_content_reviewer_dev TO valo_reviewer_login;
--> statement-breakpoint
-- What recording a review's attempt needs: reading the attempts, to count the day's and find one for
-- the same request, adding one, and recording how it went.
GRANT SELECT ON public.valo_publication_ai_attempts TO valo_content_reviewer_dev;
--> statement-breakpoint
GRANT INSERT (candidate_hash, role, request_hash, request_meter, outcome)
  ON public.valo_publication_ai_attempts TO valo_content_reviewer_dev;
--> statement-breakpoint
GRANT UPDATE (outcome, provider_response_id, input_tokens, output_tokens, error_code, completed_at)
  ON public.valo_publication_ai_attempts TO valo_content_reviewer_dev;
--> statement-breakpoint
-- What recording a drafting attempt needs: counting the day's and adding one.
GRANT SELECT ON public.valo_publication_ai_attempts TO valo_content_drafter_dev;
--> statement-breakpoint
GRANT INSERT (candidate_hash, role) ON public.valo_publication_ai_attempts TO valo_content_drafter_dev;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE public.valo_publication_ai_attempts_id_seq
  TO valo_content_reviewer_dev, valo_content_drafter_dev;
--> statement-breakpoint
-- session_user is the login the session authenticated as; SET ROLE does not change it.
CREATE FUNCTION public.valo_ai_attempt_needs_its_login() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An AI attempt is never removed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'An AI attempt keeps its role' USING ERRCODE = '23514';
  END IF;
  IF NEW.role = 'draft' THEN
    IF session_user <> 'valo_drafter_login' THEN
      RAISE EXCEPTION 'A drafting attempt is recorded only by a session that logged in as valo_drafter_login'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user <> 'valo_reviewer_login' THEN
    RAISE EXCEPTION 'A review attempt is recorded only by a session that logged in as valo_reviewer_login'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_ai_attempt_needs_its_login() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER valo_ai_attempt_requires_its_login BEFORE INSERT OR UPDATE OR DELETE
  ON public.valo_publication_ai_attempts FOR EACH ROW EXECUTE FUNCTION public.valo_ai_attempt_needs_its_login();
--> statement-breakpoint
CREATE TRIGGER valo_publication_ai_attempts_no_truncate BEFORE TRUNCATE ON public.valo_publication_ai_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();
--> statement-breakpoint
CREATE TRIGGER valo_publication_ai_attempts_digest AFTER INSERT OR UPDATE OR DELETE
  ON public.valo_publication_ai_attempts FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain();
--> statement-breakpoint
-- The table already holds attempts, so its digest starts from the rows it holds now
-- (20261126001058_history_digest_reseed), and its trigger keeps it from here.
SELECT public.valo_history_digest_reseed('public.valo_publication_ai_attempts');
