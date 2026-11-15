-- Additive financial workflow. Customer concerns never create bank disputes.
CREATE TABLE valo_payment_concerns (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, order_id uuid NOT NULL,
 request_key uuid NOT NULL, input_hash text NOT NULL CHECK(length(input_hash)=64), message text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','needs_information','responded','closed')),
 latest_reply text, version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_concern_order_scope FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id),
 CONSTRAINT valo_concern_request_once UNIQUE(workspace_id,request_key)
);
CREATE TABLE valo_dispute_workflows (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, order_id uuid NOT NULL, dispute_id uuid NOT NULL REFERENCES valo_payment_disputes(id),
 provider_id text NOT NULL UNIQUE, canonical_status text NOT NULL, provider_resolution text, provider_amount_kobo integer,
 category text, held boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 checked_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_dispute_workflow_order_scope FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id),
 CONSTRAINT valo_dispute_workflow_scope UNIQUE(workspace_id,order_id,id)
);
CREATE TABLE valo_dispute_intents (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, order_id uuid NOT NULL, workflow_id uuid NOT NULL,
 request_key uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('receipt_upload','evidence','resolve')),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','dispatching','acknowledged','unknown','needs_review','cancelled','reconciled')),
 input_hash text NOT NULL CHECK(length(input_hash)=64), payload jsonb NOT NULL CHECK(octet_length(payload::text)<=3000000),
 source_reference text NOT NULL, summary text NOT NULL, facts jsonb NOT NULL, authorised_by text NOT NULL,
 lease_token uuid,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
 provider_filename text,provider_evidence_id text,failure text,created_at timestamptz NOT NULL DEFAULT now(),attempted_at timestamptz,acknowledged_at timestamptz,
 CONSTRAINT valo_dispute_intent_key_once UNIQUE(workflow_id,request_key),
 CONSTRAINT valo_dispute_intent_workflow_scope FOREIGN KEY(workspace_id,order_id,workflow_id) REFERENCES valo_dispute_workflows(workspace_id,order_id,id),
 CHECK ((state='dispatching')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK (state<>'acknowledged' OR acknowledged_at IS NOT NULL),
 CHECK ((state IN ('prepared','cancelled') AND attempts=0) OR (state NOT IN ('prepared','cancelled') AND attempts=1))
);
CREATE UNIQUE INDEX valo_dispute_intent_operation_once ON valo_dispute_intents(workflow_id,operation) WHERE state<>'cancelled';
CREATE INDEX valo_dispute_intent_recovery_idx ON valo_dispute_intents(state,lease_until);
CREATE TABLE valo_dispute_audit (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,order_id uuid NOT NULL,workflow_id uuid REFERENCES valo_dispute_workflows(id),concern_id uuid REFERENCES valo_payment_concerns(id),
 intent_id uuid REFERENCES valo_dispute_intents(id),actor_type text NOT NULL CHECK(actor_type IN ('customer','finance','worker')),actor_id text NOT NULL,
 action text NOT NULL,reason text NOT NULL,customer_visible boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_dispute_audit_order_scope FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
CREATE FUNCTION valo_dispute_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='valo_dispute_audit' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Dispute audit/intent history is immutable'; END IF;
 IF (NEW.id,NEW.workspace_id,NEW.order_id,NEW.workflow_id,NEW.request_key,NEW.operation,NEW.input_hash,NEW.payload,NEW.source_reference,NEW.summary,NEW.facts,NEW.authorised_by,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.order_id,OLD.workflow_id,OLD.request_key,OLD.operation,OLD.input_hash,OLD.payload,OLD.source_reference,OLD.summary,OLD.facts,OLD.authorised_by,OLD.created_at)
 THEN RAISE EXCEPTION 'Prepared dispute evidence cannot be rewritten'; END IF;
 IF OLD.attempts=1 AND (NEW.attempts<>1 OR NEW.state IN ('prepared','cancelled')) THEN RAISE EXCEPTION 'A dispatched dispute action cannot be retried'; END IF;
 IF OLD.state IN ('acknowledged','reconciled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Acknowledged dispute receipt cannot be rewritten'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER valo_dispute_intent_immutable BEFORE UPDATE OR DELETE ON valo_dispute_intents FOR EACH ROW EXECUTE FUNCTION valo_dispute_immutable();
CREATE TRIGGER valo_dispute_audit_immutable BEFORE UPDATE OR DELETE ON valo_dispute_audit FOR EACH ROW EXECUTE FUNCTION valo_dispute_immutable();

CREATE TABLE valo_concern_messages (
 id uuid PRIMARY KEY REFERENCES valo_dispute_audit(id),workspace_id uuid NOT NULL,order_id uuid NOT NULL,concern_id uuid NOT NULL REFERENCES valo_payment_concerns(id),
 body text NOT NULL CHECK(length(body) BETWEEN 10 AND 2000),created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_concern_message_order_scope FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
