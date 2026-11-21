-- Reviewed additive development migration. No prices, approvals, orders or entitlements are seeded.
CREATE TABLE valo_prices (
 id uuid PRIMARY KEY, content_version_id uuid NOT NULL REFERENCES valo_content_versions(id),
 title text NOT NULL, amount_kobo integer NOT NULL CHECK (amount_kobo > 0),
 currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
 licence_version text NOT NULL, licence_text text NOT NULL, tax_treatment text NOT NULL,
 approval_reference text NOT NULL CHECK (length(approval_reference) > 0),
 effective_from timestamptz NOT NULL, effective_to timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TABLE valo_orders (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES valo_workspaces(id), requested_by text NOT NULL,
 reference text NOT NULL, request_key uuid NOT NULL, price_id uuid NOT NULL REFERENCES valo_prices(id), line jsonb NOT NULL,
 amount_kobo integer NOT NULL CHECK (amount_kobo > 0), currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
 status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','pending','abandoned','failed','verified_success','needs_review','reversed')),
 provider_transaction_id text, checkout_url text, last_checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX valo_order_reference_unique ON valo_orders(reference);
CREATE UNIQUE INDEX valo_order_workspace_key_unique ON valo_orders(workspace_id,request_key);
CREATE UNIQUE INDEX valo_order_tenant_id_unique ON valo_orders(workspace_id,id);
CREATE UNIQUE INDEX valo_order_provider_transaction_unique ON valo_orders(provider_transaction_id);
CREATE INDEX valo_orders_workspace_created_idx ON valo_orders(workspace_id,created_at);
CREATE TABLE valo_payment_events (
 id uuid PRIMARY KEY,event_key text NOT NULL,body_hash text NOT NULL,event_type text NOT NULL,reference text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','needs_review','ignored')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),failure text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX valo_payment_event_key_unique ON valo_payment_events(event_key);
CREATE INDEX valo_payment_event_status_idx ON valo_payment_events(status);
CREATE TABLE valo_entitlements (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES valo_workspaces(id),order_id uuid NOT NULL,
 content_version_id uuid NOT NULL REFERENCES valo_content_versions(id),status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_entitlement_order_tenant_fk FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
CREATE UNIQUE INDEX valo_entitlement_order_unique ON valo_entitlements(order_id);
CREATE INDEX valo_entitlement_workspace_idx ON valo_entitlements(workspace_id,content_version_id);
CREATE TABLE valo_purchase_outbox (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES valo_workspaces(id),order_id uuid NOT NULL,
 kind text NOT NULL DEFAULT 'purchase_receipt',status text NOT NULL DEFAULT 'awaiting_email_configuration',
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_purchase_outbox_order_tenant_fk FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
CREATE UNIQUE INDEX valo_purchase_outbox_once ON valo_purchase_outbox(order_id,kind);
CREATE TABLE valo_refund_requests (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES valo_workspaces(id),order_id uuid NOT NULL,
 reason text NOT NULL,status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','authorised','provider_pending','processed','failed','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_refund_order_tenant_fk FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
CREATE UNIQUE INDEX valo_refund_request_order_unique ON valo_refund_requests(order_id);
CREATE TABLE valo_payment_reconciliations (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES valo_workspaces(id),order_id uuid NOT NULL,
 day text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','matched','needs_review')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),finding text,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT valo_reconciliation_order_tenant_fk FOREIGN KEY(workspace_id,order_id) REFERENCES valo_orders(workspace_id,id)
);
CREATE UNIQUE INDEX valo_reconciliation_order_day_unique ON valo_payment_reconciliations(order_id,day);
