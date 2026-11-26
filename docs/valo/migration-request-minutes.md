# Applying the request minutes migration to the development database

`20261126134418_request_minutes` adds the table the API counts its requests in, by the minute, for the
alerts on unexpected failures and slow requests ([alerts that reach a person](../architecture/alerts.md),
part 3). It needs the operational alerts migrations (`20261126125423_operational_alert_guards`) first.
It has not been applied to the Replit development database yet.

- It adds `valo_request_minutes`, empty. Each row is one minute: how many of the API's requests began in
  it, how many failed unexpectedly, and how many took at most each of seven fixed times. It holds no
  address, identity or request content, and no workspace's rows, and customer requests have no privilege
  on it.
- It refuses counts that do not hold together: a time that is not a whole minute, more failures than
  requests, or a count of quicker requests above a count of slower ones.
- It changes no row.

**Without this migration, the API's counts are not kept.** Each API process logs once that its counts
wait to be written, keeps at most an hour of them, and drops older ones. The worker cannot take the two
request readings, so `REQUEST_FAILURES_PROBE_UNAVAILABLE` and `REQUEST_TIME_PROBE_UNAVAILABLE` stand in
the System area's alerts. Nothing else changes: requests are answered as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the operational alerts migrations:
   `SELECT to_regprocedure('public.valo_operational_alert_guard()')` is not null, and
   `SELECT to_regclass('public.valo_request_minutes')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126134418_request_minutes.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_request_minutes` is 0.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_request_minutes', 'SELECT')` is false.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.
6. Start the API and the worker again. Within a minute or two the API writes its counts, and the two
   probe alerts clear.

To roll back, drop the table `valo_request_minutes`. It holds only counts, so nothing a person did is
lost; the alerts on failures and time stop until it is back.
