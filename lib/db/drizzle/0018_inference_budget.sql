-- Additive, disabled preparation only. No automatic activation or grants.
CREATE TABLE valo_inference_budgets (
  id text PRIMARY KEY,
  policy_hash text NOT NULL,
  state jsonb NOT NULL CHECK (jsonb_typeof(state)='object'),
  version integer NOT NULL DEFAULT 0 CHECK (version>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE valo_inference_budget_events (
  id bigserial PRIMARY KEY,
  budget_id text NOT NULL REFERENCES valo_inference_budgets(id),
  version integer NOT NULL,
  action text NOT NULL,
  before_hash text NOT NULL,
  after_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valo_inference_event_version UNIQUE(budget_id,version)
);
