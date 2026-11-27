# Applying the security signal kinds migration to the development database

`20261126141258_security_signal_guard_refusal` lets the security signals table take a database guard's
refusal ([the audit trail](../architecture/audit-trail.md), slice 3). It needs the request minutes
migration (`20261126134418_request_minutes`) first. It has not been applied to the Replit development
database yet.

- The error handler counts each request a database guard refused as a security signal of the kind
  `guard_refusal`, and the worker raises `GUARD_REFUSALS_DETECTED` on it. The table's kind check took
  only `denied_access` and `signature_failure`, so it refused every such count and none was kept: the
  alert could not be raised.
- It replaces the kind check with one that takes the three kinds. The table holds only rows of the first
  two, which the new check keeps.
- It changes no row, and customer requests still have no privilege on the table.

**Without this migration, a guard's refusal is not counted.** Each one is answered and logged as before
(`request.refused_by_guard`, with the guard's name), the count is refused and logged as
`security_signal.failed`, and `GUARD_REFUSALS_DETECTED` stays clear. Nothing else changes.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the request minutes migration, and the check is the old one:
   - `SELECT to_regclass('public.valo_request_minutes')` is not null;
   - `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'valo_security_signals_kind_check'`
     names `denied_access` and `signature_failure` only.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126141258_security_signal_guard_refusal.sql
   ```

4. Check that these return what follows:
   - the check from step 1 names `denied_access`, `signature_failure` and `guard_refusal`;
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_security_signals', 'INSERT')` is false.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.
6. Start the API and the worker again. A guard's refusal is counted from then on.

To roll back, remove the rows of the kind `guard_refusal` (they are counts only, and expire within a day
anyway), then put back the check that names the first two kinds. Guard refusals are then not counted
again.

## Refusals by a limit and refused input

`20261126142600_security_signal_limits_and_input` lets the table take two more kinds
([alerts that reach a person](../architecture/alerts.md), part 2). It needs the migration above first.
It has not been applied to the Replit development database yet.

- The API counts each refusal by a limit (429) as `limit_refusal`, and each answer refusing a request's
  input (400, 413, 415 or 422) as `refused_input`, for `LIMITED_CALLERS_DETECTED` and
  `REFUSED_INPUT_DETECTED`.
- It replaces the kind check with one that takes the five kinds. It changes no row.

**Without this migration, those two kinds are not counted.** Each such answer is given as before, and
its count is refused and logged as `security_signal.failed`; the two alerts stay clear.
`SPREAD_REFUSALS_DETECTED` reads refusals of access, which the table already takes.

1. Confirm the database is at the migration above: the check from its step 1 names `guard_refusal`.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126142600_security_signal_limits_and_input.sql
   ```

4. Check that the check names `limit_refusal` and `refused_input` too, and that
   `SELECT has_table_privilege('valo_workspace_scope', 'valo_security_signals', 'INSERT')` is still false.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.
6. Start the API and the worker again.

To roll back, remove the rows of the two kinds, then put back the check that names three.
