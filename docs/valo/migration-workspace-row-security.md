# Applying the workspace row security migration to the development database

`20261117125444_workspace_row_security` adds PostgreSQL row-level security for
workspace scoping (decision 0008). It has not been applied to the Replit development
database yet.

- It creates the role `valo_workspace_scope` (no login, no row-security bypass). If
  the role already exists with any of those privileges, the migration refuses to
  continue.
- It grants that role only the commands customer requests use, table by table, and
  makes the role running the migration a member, so the application can switch to
  it. 16 tables, among them every staff table and the inference budget, give it
  nothing. Tables created later give it nothing until a migration grants it.
- On the six tables whose rows customer requests lock but never change
  (memberships, prices, content versions, support tickets, file records and
  inference batches) a trigger refuses every update the role attempts.
- It adds the functions that now write the shared inference ledger for every caller:
  `valo_inference_budget_lock`, `valo_inference_budget_commit` (with its check,
  `valo_inference_customer_change_refusal`) and `valo_inference_batch_record_result`.
  For the scoped role, the commit allows only what a customer AI attempt does.
- It adds `valo_customer_ai_reservations`, which returns only the shared AI usage
  totals, so the shared daily ceiling and the per-person limit still count every
  workspace. Only `valo_workspace_scope` and its owner may call it.
- It turns on row-level security on the 45 tables that hold workspace rows,
  including payment events, which belong to the workspace whose order, refund or
  dispute they reference. Each gets one policy limiting `valo_workspace_scope` to the
  rows of the workspace in `valo.workspace_id`. The application role owns the
  tables, so its own queries, and with them workers, staff routes and operator
  commands, are not affected.
- No row is read or written.

Apply it before running code that includes it. That code runs every customer request
as `valo_workspace_scope`, so without the migration every customer request fails with
`DB_WORKSPACE_SCOPE_UNAVAILABLE`, though no connection is leaked. Operator inference
commands also write the ledger through its functions, so they fail until it is
applied.

The Replit development database has no Drizzle ledger. Follow the existing
procedure in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the constraint names migration (the constraint
   `valo_orders_workspace_id_valo_workspaces_id_fk` exists) and that
   `valo_workspace_scope` does not exist. Confirm the application's role can create
   roles: the earlier editorial roles were created the same way.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
4. Check that `SELECT count(*) FROM pg_policies WHERE policyname='valo_workspace_scope'`
   returns 45, and that `node lib/db/scripts/workspace-row-security.mjs`, run from the
   repository root with the database's `DATABASE_URL`, prints `no gaps`. As the
   application role, check that
   `BEGIN; SELECT set_config('valo.workspace_id', gen_random_uuid()::text, true),
   set_config('role', 'valo_workspace_scope', true); SELECT count(*) FROM
   valo_documents; ROLLBACK;` counts 0. Then deploy the code, restart the API and
   worker, and run the usual smoke checks.

To undo it, roll the code back first. Then drop each `valo_workspace_scope` policy
and `valo_workspace_scope_lock_only` trigger, disable row-level security on those
tables, drop the functions `valo_customer_ai_reservations`,
`valo_refuse_scoped_update`, `valo_inference_budget_lock`,
`valo_inference_budget_commit`, `valo_inference_customer_change_refusal` and
`valo_inference_batch_record_result`, revoke the grants, and drop the role. Code
from before this migration writes the ledger tables directly, so it keeps working
once the code is rolled back.

Never run the full migrator against this database and never write ledger rows.
`lib/db/scripts/phase1-migrations.test.mjs` checks the upgrade on tracked and
unjournalled databases. It also checks every table with workspace rows, the role's
exact privileges, the lock-only triggers, the functions it may call and the absence
of any other policy, using `lib/db/scripts/workspace-row-security.mjs`.
