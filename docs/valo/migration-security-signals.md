# Applying the security signals migration to the development database

`20261118002215_security_signals` adds the table SEC-008's internal alerts count security
events in. It has not been applied to the Replit development database yet.

- It creates `valo_security_signals`: per kind (`denied_access` or `signature_failure`),
  pseudonymous subject and minute, how many events there were, and when the row expires
  (a day later). The subject is a keyed hash of the caller's address; the table holds no
  address, identity or request content. Checks refuse any other kind and any subject that
  is not a 64-character hash.
- It grants nothing. The application role owns the table and is the only writer; customer
  requests acting as `valo_workspace_scope` can neither read nor write it.
- No existing row is read or written.

Code that includes it counts every refused request (401 or 403) and every rejected payment
webhook signature after the response is sent, and the operations probe reads the counts.
Until the table exists, counting fails without changing any response (each failure is
logged as `security_signal.failed`), and the probe raises `DENIED_ACCESS_PROBE_UNAVAILABLE`
and `SIGNATURE_FAILURES_PROBE_UNAVAILABLE`. Apply the migration before running that code.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the row security migration (`valo_scope_keys` exists) and
   that `valo_security_signals` does not exist.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261118002215_security_signals.sql
   ```

4. Check that the table exists and that the scoped role has no access to it:
   `SELECT has_table_privilege('valo_workspace_scope', 'valo_security_signals', 'SELECT')`
   returns `false`.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

The alert thresholds (more than 20 refusals of one address in ten minutes; any signature
failure, staff role change or caller at a quota limit) are development defaults in
`valo-operations.ts`, not reviewed values.
