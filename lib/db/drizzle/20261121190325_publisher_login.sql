-- A login for the publisher alone (decision 0017, point 6). Custom SQL: roles, functions and
-- triggers are hand-written.
--
-- Until now the publisher was a role the application's own login switched to. That login owns the
-- tables, so the same connection that drafts and reviews could set a candidate to published with one
-- statement, whatever role it had switched to. From this migration a content version becomes
-- published only in a database session that logged in as valo_publisher_login. The login may become
-- the publisher role and nothing else, and holds nothing of its own (NOINHERIT), so it reads no
-- customer drafts, prices or orders, as the publisher role does not.
--
-- Holding and withdrawing a version take content away and stay open to the application's login.
DO $$
BEGIN
  -- Created without login; each environment gives it a password and stores the connection string
  -- as VALO_PUBLISHER_DATABASE_URL (lib/db/scripts/publisher-login.mjs).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valo_publisher_login') THEN
    CREATE ROLE valo_publisher_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valo_publisher_login'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
    RAISE EXCEPTION 'valo_publisher_login already exists with privileges it must not have';
  END IF;
END $$;
--> statement-breakpoint
GRANT valo_content_publisher_dev TO valo_publisher_login;
--> statement-breakpoint
-- session_user is the login the session authenticated as; SET ROLE does not change it.
CREATE FUNCTION public.valo_publication_needs_publisher_login() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published'
      AND session_user <> 'valo_publisher_login' THEN
    RAISE EXCEPTION 'A content version is published only by a session that logged in as valo_publisher_login'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fires after valo_version_immutable (triggers on one event fire in name order), so an invalid
-- transition is still refused for its own reason first.
CREATE TRIGGER valo_version_publisher_login BEFORE UPDATE OF status ON valo_content_versions
  FOR EACH ROW EXECUTE FUNCTION public.valo_publication_needs_publisher_login();
