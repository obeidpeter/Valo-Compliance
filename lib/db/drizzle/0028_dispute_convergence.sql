-- Additive convergence. Preserve existing 0025/0026 action rows and history.
ALTER TABLE valo_payment_disputes ADD COLUMN held boolean NOT NULL DEFAULT false, ADD COLUMN control_version integer NOT NULL DEFAULT 1;
ALTER TABLE valo_dispute_actions ADD COLUMN lease_until timestamptz;
CREATE FUNCTION valo_guard_dispute_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Dispute action history is immutable'; END IF;
 IF (NEW.id,NEW.workspace_id,NEW.order_id,NEW.dispute_id,NEW.request_key,NEW.kind,NEW.information_id,NEW.payload,NEW.source_hash,NEW.policy_version,NEW.authorised_by,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.order_id,OLD.dispute_id,OLD.request_key,OLD.kind,OLD.information_id,OLD.payload,OLD.source_hash,OLD.policy_version,OLD.authorised_by,OLD.created_at)
 THEN RAISE EXCEPTION 'Prepared dispute inputs are immutable'; END IF;
 IF NEW.attempts<OLD.attempts OR (OLD.attempts>0 AND NEW.status='prepared') THEN RAISE EXCEPTION 'Sent dispute actions cannot re-enter preparation'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER valo_dispute_intent_guard BEFORE UPDATE OR DELETE ON valo_dispute_actions FOR EACH ROW EXECUTE FUNCTION valo_guard_dispute_intent();
CREATE TABLE valo_payment_concerns (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,order_id uuid NOT NULL,request_key uuid NOT NULL,input_hash text NOT NULL CHECK(length(input_hash)=64),message text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','needs_information','responded','closed')),latest_reply text,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id),UNIQUE(workspace_id,request_key),UNIQUE(workspace_id,order_id,id)
);
CREATE TABLE valo_payment_concern_events (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,order_id uuid NOT NULL,concern_id uuid NOT NULL,
 actor_type text NOT NULL CHECK(actor_type IN ('customer','finance','worker')),actor_id text NOT NULL,action text NOT NULL,reason text NOT NULL,customer_visible boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,order_id,concern_id) REFERENCES valo_payment_concerns(workspace_id,order_id,id)
);
CREATE TRIGGER valo_concern_event_history BEFORE UPDATE OR DELETE ON valo_payment_concern_events FOR EACH ROW EXECUTE FUNCTION valo_guard_dispute_history();
CREATE TABLE valo_concern_messages (
 id uuid PRIMARY KEY REFERENCES valo_payment_concern_events(id),workspace_id uuid NOT NULL,order_id uuid NOT NULL,concern_id uuid NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 10 AND 2000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,order_id,concern_id) REFERENCES valo_payment_concerns(workspace_id,order_id,id)
);
