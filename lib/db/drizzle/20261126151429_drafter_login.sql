-- A login for drafting alone (docs/architecture/service-logins.md, part 1; SEC-006). Custom SQL:
-- roles, functions and triggers are hand-written.
--
-- Until now the drafter was a role the application's own login switched to. That login owns the
-- tables, so anything holding its connection string, the API included, could add a candidate. From
-- this migration a content version or a prepared candidate is added only in a database session that
-- logged in as valo_drafter_login. The login may become the drafter role and nothing else, and holds
-- nothing of its own (NOINHERIT), so it reads no customer data, as the drafter role does not.
DO $$
BEGIN
  -- Created without login; each environment gives it a password and stores the connection string
  -- as VALO_DRAFTER_DATABASE_URL (lib/db/scripts/drafter-login.mjs).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valo_drafter_login') THEN
    CREATE ROLE valo_drafter_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valo_drafter_login'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
    RAISE EXCEPTION 'valo_drafter_login already exists with privileges it must not have';
  END IF;
END $$;
--> statement-breakpoint
GRANT valo_content_drafter_dev TO valo_drafter_login;
--> statement-breakpoint
-- session_user is the login the session authenticated as; SET ROLE does not change it.
CREATE FUNCTION public.valo_content_needs_drafter_login() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF session_user <> 'valo_drafter_login' THEN
    RAISE EXCEPTION 'Content is added only by a session that logged in as valo_drafter_login'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_content_needs_drafter_login() FROM PUBLIC;
--> statement-breakpoint
-- Fires after valo_version_immutable (triggers on one event fire in name order), so a version that is
-- not a candidate is still refused for its own reason first.
CREATE TRIGGER valo_version_requires_drafter_login BEFORE INSERT ON public.valo_content_versions
  FOR EACH ROW EXECUTE FUNCTION public.valo_content_needs_drafter_login();
--> statement-breakpoint
CREATE TRIGGER valo_prepared_candidate_requires_drafter_login BEFORE INSERT ON public.valo_prepared_candidates
  FOR EACH ROW EXECUTE FUNCTION public.valo_content_needs_drafter_login();
