# Applying the workspace row security migration to the development database

`20261117125444_workspace_row_security` adds PostgreSQL row-level security for
workspace scoping, and makes the scope a credential boundary (decision 0008). It has
not been applied to the Replit development database yet.

- It creates two roles, neither of which can bypass row security or administer the
  database: `valo_workspace_scope`, which customer requests act as, and
  `valo_workspace_login`, which they connect as. The login cannot log in until step 4
  below enables it, may become only the scoped role, and holds nothing itself. If
  either role already exists with privileges it must not have, the migration refuses
  to continue. The application role becomes a member of neither.
- It grants the scoped role only the commands customer requests use, table by table.
  16 tables, among them every staff table and the inference budget, give it nothing.
  Tables created later give it nothing until a migration grants it.
- It adds `valo_scope_keys`, where each application process registers the key it
  signs workspace credentials with, and `valo_scope_workspace()`, which returns the
  workspace a transaction's credential names if the application signed it for that
  transaction. Only the application role can read the keys.
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
  rows of the workspace `valo_scope_workspace()` returns. The application role owns the
  tables, so its own queries, and with them workers, staff routes and operator
  commands, are not affected.
- No row is read or written.

Apply it, and enable the login, before running code that includes it. That code
connects every customer request as `valo_workspace_login` through
`VALO_CUSTOMER_DATABASE_URL`, so until both are done every customer request fails with
`DB_WORKSPACE_SCOPE_UNAVAILABLE`, though no connection is leaked. Operator inference
commands also write the ledger through its functions, so they fail until it is
applied.

The Replit development database has no Drizzle ledger. Follow the existing
procedure in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the constraint names migration (the constraint
   `valo_orders_workspace_id_valo_workspaces_id_fk` exists) and that neither
   `valo_workspace_scope` nor `valo_workspace_login` exists. Confirm the application's
   role can create roles: the earlier editorial roles were created the same way.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
4. Generate a password of at least 24 printable ASCII characters and store it in the
   secret store as `VALO_WORKSPACE_LOGIN_PASSWORD`. From the repository root, with
   the database's `DATABASE_URL`, run
   `node lib/db/scripts/workspace-login.mjs --print-url`. It enables the login with
   that password, sending the server only its SCRAM verifier, and prints the
   connection string. Store that in the secret store as `VALO_CUSTOMER_DATABASE_URL`
   and nowhere else. It must reach the database directly or through a session
   pooler, never a transaction pooler.
5. Check that `SELECT count(*) FROM pg_policies WHERE policyname='valo_workspace_scope'`
   returns 45, and that `node lib/db/scripts/workspace-row-security.mjs`, run the same
   way, prints `no gaps`. Connected with `VALO_CUSTOMER_DATABASE_URL`, check that
   `SELECT count(*) FROM valo_documents` is refused with `permission denied`, and that
   `BEGIN; SET LOCAL ROLE valo_workspace_scope; SELECT count(*) FROM valo_documents;
   ROLLBACK;` counts 0: without a credential the scoped role sees no workspace. Then
   deploy the code, restart the API and worker, and run the usual smoke checks.

To change the login's password, repeat step 4 with the new password, then restart the
API. Connections that are already open keep working until they close.

To undo it, roll the code back first. Then drop each `valo_workspace_scope` policy
and `valo_workspace_scope_lock_only` trigger, disable row-level security on those
tables, drop the functions `valo_scope_workspace`, `valo_customer_ai_reservations`,
`valo_refuse_scoped_update`, `valo_inference_budget_lock`,
`valo_inference_budget_commit`, `valo_inference_customer_change_refusal` and
`valo_inference_batch_record_result`, drop the table `valo_scope_keys`, revoke the
grants, and drop `valo_workspace_login`, then `valo_workspace_scope`. Remove
`VALO_CUSTOMER_DATABASE_URL` and `VALO_WORKSPACE_LOGIN_PASSWORD` from the secret
store. Code from before this migration writes the ledger tables directly, so it keeps
working once the code is rolled back.

Never run the full migrator against this database and never write ledger rows.
`lib/db/scripts/phase1-migrations.test.mjs` checks the upgrade on tracked and
unjournalled databases. It also checks every table with workspace rows, the role's
exact privileges, the lock-only triggers, the functions it may call, the absence of
any other policy, and that the login can become only the scoped role and holds
nothing itself, using `lib/db/scripts/workspace-row-security.mjs`. It shows that a
forged credential, a bare workspace id or a credential from another transaction
names no workspace.
