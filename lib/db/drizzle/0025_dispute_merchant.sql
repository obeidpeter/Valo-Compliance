-- Reviewed additive development migration. No startup schema push.
ALTER TABLE valo_payment_disputes ADD COLUMN provider_updated_at timestamptz, ADD COLUMN snapshot_hash text;
CREATE TABLE valo_dispute_information (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, order_id uuid NOT NULL,
 dispute_id uuid NOT NULL REFERENCES valo_payment_disputes(id), actor_id text NOT NULL,
 request_key uuid NOT NULL, information jsonb NOT NULL, consent_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id),
 UNIQUE(workspace_id,request_key)
);
CREATE TABLE valo_dispute_actions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, order_id uuid NOT NULL,
 dispute_id uuid NOT NULL REFERENCES valo_payment_disputes(id), request_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('upload_receipt','submit_evidence','merchant_decision')),
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','dispatching','acknowledged','observed','unknown','cancelled')),
 version integer NOT NULL DEFAULT 1, information_id uuid REFERENCES valo_dispute_information(id),
 payload jsonb NOT NULL, source_hash text NOT NULL, policy_version text NOT NULL,
 authorised_by text NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
 claim_token uuid, result jsonb, failure text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id), UNIQUE(dispute_id,request_key)
);
CREATE UNIQUE INDEX valo_dispute_one_intent ON valo_dispute_actions(dispute_id,kind) WHERE status<>'cancelled';
CREATE INDEX valo_dispute_action_order ON valo_dispute_actions(workspace_id,order_id);
-- Enforce selected-dispute tenant/order binding, including operator mistakes.
ALTER TABLE valo_payment_disputes ADD CONSTRAINT valo_dispute_exact_binding UNIQUE(workspace_id,order_id,id);
ALTER TABLE valo_dispute_information ADD FOREIGN KEY(workspace_id,order_id,dispute_id)
 REFERENCES valo_payment_disputes(workspace_id,order_id,id);
ALTER TABLE valo_dispute_actions ADD FOREIGN KEY(workspace_id,order_id,dispute_id)
 REFERENCES valo_payment_disputes(workspace_id,order_id,id);
ALTER TABLE valo_dispute_information ADD CONSTRAINT valo_dispute_info_exact_binding UNIQUE(workspace_id,order_id,dispute_id,id);
ALTER TABLE valo_dispute_actions ADD FOREIGN KEY(workspace_id,order_id,dispute_id,information_id)
 REFERENCES valo_dispute_information(workspace_id,order_id,dispute_id,id);
CREATE TABLE valo_dispute_transitions(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,order_id uuid NOT NULL,
 action_id uuid NOT NULL REFERENCES valo_dispute_actions(id),actor_id text NOT NULL,status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
CREATE FUNCTION valo_guard_dispute_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Dispute transition history is immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER valo_dispute_history_immutable BEFORE UPDATE OR DELETE ON valo_dispute_transitions
 FOR EACH ROW EXECUTE FUNCTION valo_guard_dispute_history();
