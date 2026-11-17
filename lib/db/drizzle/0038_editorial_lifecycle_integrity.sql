-- Additive development review: preserve captured source history and separate the reviewer role.
CREATE FUNCTION valo_source_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Retained source snapshots are append-only';
END $$;
CREATE TRIGGER valo_source_snapshot_immutable BEFORE UPDATE OR DELETE ON valo_source_snapshots
 FOR EACH ROW EXECUTE FUNCTION valo_source_snapshot_immutable();
CREATE ROLE valo_content_reviewer_dev NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA public TO valo_content_reviewer_dev;
GRANT SELECT ON valo_publication_policies,valo_content_versions,valo_source_snapshots TO valo_content_reviewer_dev;
-- No publication, policy, customer, financial, role-management or audit mutation grant.
