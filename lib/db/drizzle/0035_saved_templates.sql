-- Keys and indexes use the names in the Drizzle snapshot.
CREATE TABLE valo_saved_templates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL CONSTRAINT valo_saved_templates_workspace_id_valo_workspaces_id_fk REFERENCES valo_workspaces(id),
  template_id text NOT NULL CONSTRAINT valo_saved_template_identity CHECK (length(template_id) BETWEEN 1 AND 80),
  saved_title text NOT NULL CONSTRAINT valo_saved_template_title CHECK (length(saved_title) BETWEEN 1 AND 300),
  saved_version integer NOT NULL CONSTRAINT valo_saved_template_version CHECK (saved_version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX valo_saved_template_unique ON valo_saved_templates(workspace_id,template_id);
