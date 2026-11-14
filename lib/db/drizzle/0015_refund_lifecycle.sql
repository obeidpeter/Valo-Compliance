-- Additive development evolution. Legacy requests retain unknown amounts and
-- cannot be approved until replaced with an explicit policy-bound request.
ALTER TABLE valo_refund_requests
 ADD COLUMN amount_kobo integer CHECK(amount_kobo > 0),
 ADD COLUMN request_key uuid,
 ADD COLUMN reference text,
 ADD COLUMN policy_version text NOT NULL DEFAULT 'legacy-unconfirmed',
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 ADD COLUMN decision_reason text,
 ADD COLUMN authorised_by text,
 ADD COLUMN authorised_at timestamptz,
 ADD COLUMN provider_id text,
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN next_attempt_at timestamptz,
 ADD COLUMN checked_at timestamptz,
 ADD COLUMN completed_at timestamptz,
 ADD COLUMN failure text;
UPDATE valo_refund_requests SET request_key=id, reference='vr-test-'||id::text;
ALTER TABLE valo_refund_requests DROP CONSTRAINT valo_refund_requests_status_check;
ALTER TABLE valo_refund_requests ADD CONSTRAINT valo_refund_requests_status_check
 CHECK(status IN('requested','authorised','provider_pending','approved','rejected','submitting','unknown','pending','processing','needs_attention','needs_review','failed','processed'));
ALTER TABLE valo_refund_requests ALTER COLUMN request_key SET NOT NULL,
 ALTER COLUMN request_key SET DEFAULT gen_random_uuid(), ALTER COLUMN reference SET NOT NULL;
DROP INDEX valo_refund_request_order_unique;
CREATE UNIQUE INDEX valo_refund_request_key_unique ON valo_refund_requests(workspace_id,request_key);
CREATE UNIQUE INDEX valo_refund_reference_unique ON valo_refund_requests(reference);
CREATE UNIQUE INDEX valo_refund_provider_unique ON valo_refund_requests(provider_id);
CREATE INDEX valo_refund_queue_idx ON valo_refund_requests(status,next_attempt_at);
CREATE TABLE valo_refund_transitions(
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, order_id uuid NOT NULL,
 refund_id uuid NOT NULL REFERENCES valo_refund_requests(id), actor_id text NOT NULL,
 action text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_refund_audit_order_tenant_fk FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
CREATE TABLE valo_payment_disputes(
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, order_id uuid NOT NULL,
 provider_id text NOT NULL UNIQUE,status text NOT NULL,resolution text,
 amount_kobo integer CHECK(amount_kobo >= 0),checked_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_dispute_order_tenant_fk FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
REVOKE ALL ON valo_refund_transitions,valo_payment_disputes FROM PUBLIC;
