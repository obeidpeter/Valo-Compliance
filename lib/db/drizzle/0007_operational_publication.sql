-- Reviewed additive DEVELOPMENT migration. Not a deploy/startup migration.
-- Functions, roles and grants are NOT automatically copied by Replit schema publishing.
BEGIN;
CREATE TABLE valo_publication_policies (
 id text PRIMARY KEY, hash text NOT NULL, policy jsonb NOT NULL, authority jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE valo_content_versions (
 id uuid PRIMARY KEY, template_id text NOT NULL, version integer NOT NULL CHECK(version>0),
 slug text NOT NULL, policy_id text NOT NULL REFERENCES valo_publication_policies(id),
 candidate_hash text NOT NULL, bundle jsonb NOT NULL, attestations jsonb NOT NULL,
 status text NOT NULL DEFAULT 'candidate' CHECK(status IN('candidate','held','published','withdrawn')),
 review_by timestamptz NOT NULL, published_at timestamptz, withdrawn_reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX valo_content_template_version_unique ON valo_content_versions(template_id,version);
CREATE INDEX valo_content_discovery_idx ON valo_content_versions(status,review_by,slug);
CREATE TABLE valo_publication_audit (
 id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES valo_content_versions(id),
 action text NOT NULL, actor text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE valo_documents ADD COLUMN template_version_id uuid REFERENCES valo_content_versions(id);
CREATE TABLE valo_publication_ai_attempts (
 id bigserial PRIMARY KEY, candidate_hash text NOT NULL, role text NOT NULL CHECK(role IN('factual','challenge')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION valo_publication_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME IN ('valo_publication_policies','valo_publication_audit') OR TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Publication evidence is append-only';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status <> 'candidate' THEN RAISE EXCEPTION 'Candidates cannot publish themselves'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-'status'-'published_at'-'withdrawn_reason') IS DISTINCT FROM
    (to_jsonb(OLD)-'status'-'published_at'-'withdrawn_reason') THEN
  RAISE EXCEPTION 'Content versions are immutable';
 END IF;
 IF NOT ((OLD.status='candidate' AND NEW.status IN('published','held')) OR
         (OLD.status='published' AND NEW.status='withdrawn')) THEN
  RAISE EXCEPTION 'Invalid publication transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER valo_policy_immutable BEFORE UPDATE OR DELETE ON valo_publication_policies
 FOR EACH ROW EXECUTE FUNCTION valo_publication_immutable();
CREATE TRIGGER valo_publication_audit_immutable BEFORE UPDATE OR DELETE ON valo_publication_audit
 FOR EACH ROW EXECUTE FUNCTION valo_publication_immutable();
CREATE TRIGGER valo_version_immutable BEFORE INSERT OR UPDATE OR DELETE ON valo_content_versions
 FOR EACH ROW EXECUTE FUNCTION valo_publication_immutable();
CREATE ROLE valo_content_publisher_dev NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE valo_content_drafter_dev NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA public TO valo_content_publisher_dev,valo_content_drafter_dev;
GRANT SELECT ON valo_publication_policies,valo_content_versions TO valo_content_publisher_dev,valo_content_drafter_dev;
GRANT INSERT ON valo_content_versions TO valo_content_drafter_dev;
GRANT UPDATE(status,published_at,withdrawn_reason) ON valo_content_versions TO valo_content_publisher_dev;
GRANT INSERT ON valo_publication_audit TO valo_content_publisher_dev;
COMMIT;
