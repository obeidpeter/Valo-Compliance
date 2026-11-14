-- Durable private-object tombstones deliberately have no FK to export jobs:
-- erasing document/job rows must not erase the recovery deletion instructions.
CREATE TABLE valo_privacy_erasure_objects (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  object_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','deleted','failed')),
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(case_id, object_key)
);
CREATE INDEX valo_privacy_erasure_workspace ON valo_privacy_erasure_objects(workspace_id);
