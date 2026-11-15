-- Existing provisioned assignments remain permanent. This migration grants no role.
ALTER TABLE valo_staff_assignments
 ADD COLUMN expires_at timestamptz,
 ADD COLUMN grant_mode text NOT NULL DEFAULT 'permanent' CHECK(grant_mode IN ('permanent','break_glass')),
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN granted_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE valo_staff_assignments ADD CONSTRAINT valo_staff_expiry_shape CHECK(
 (grant_mode='permanent' AND expires_at IS NULL) OR
 (grant_mode='break_glass' AND expires_at>granted_at AND expires_at<=granted_at+interval '60 minutes')
);
--> statement-breakpoint
CREATE TABLE valo_staff_role_changes (
 id uuid PRIMARY KEY, request_key uuid NOT NULL, input_hash text NOT NULL CHECK(length(input_hash)=64),
 actor_id text NOT NULL, actor_assignment_id uuid NOT NULL REFERENCES valo_staff_assignments(id),
 assignment_id uuid NOT NULL REFERENCES valo_staff_assignments(id), target_identity_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('grant','revoke')), role text NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 20 AND 1000), incident_reference text,
 before_state jsonb, after_state jsonb NOT NULL, target_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_key)
);
--> statement-breakpoint
CREATE INDEX valo_staff_role_change_time ON valo_staff_role_changes(created_at,id);
--> statement-breakpoint
CREATE FUNCTION valo_staff_role_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Staff role change history is immutable' USING ERRCODE='23514'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER valo_staff_role_history_immutable BEFORE UPDATE OR DELETE ON valo_staff_role_changes
 FOR EACH ROW EXECUTE FUNCTION valo_staff_role_history_immutable();
