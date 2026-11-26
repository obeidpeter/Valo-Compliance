# Applying the operational alerts migrations to the development database

`20261126125400_operational_alerts` and `20261126125423_operational_alert_guards` add a journal of the
alerts the worker raises and clears, which the staff page's System area reads
([alerts that reach a person](../architecture/alerts.md), part 1). They need the privacy holds
migrations (`20261126091827_privacy_hold_guards`) first. They have not been applied to the Replit
development database yet. Apply both, in order.

- **The first** adds `valo_operational_alerts`, empty. Each row is one alert raised or cleared: its code,
  when, the reading and its limit, and the runbook and roles named then. It holds no personal data and no
  workspace's rows, and customer requests have no privilege on it.
- **The second** keeps each row as the worker wrote it: a row is never changed or removed, and the table
  cannot be emptied. It keeps a history digest (ADM-009), which starts empty.
- Neither changes a row.

**Without these migrations, no alert reaches the journal.** The System area says "Alerts cannot be shown
yet: a database update is waiting to be applied. Until it is, the worker keeps them in its own file.",
and reading the alerts answers 503. The worker goes on raising and clearing alerts in its file, as
before, and logs each minute that the journal is behind. Once the journal is there, the next copy takes
every change the file still holds (it keeps the last 1,000).

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the privacy holds migrations:
   `SELECT to_regprocedure('public.valo_workspace_under_hold(uuid)')` is not null, and
   `SELECT to_regclass('public.valo_operational_alerts')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126125400_operational_alerts.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126125423_operational_alert_guards.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_operational_alerts` is 0.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_operational_alerts', 'SELECT')` is false.
   - `SELECT has_function_privilege('public', 'valo_operational_alert_guard()', 'EXECUTE')` is false.
   - `SELECT * FROM valo_history_digest_mismatches()` does not name `valo_operational_alerts`.
5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.
6. Start the worker again. Within a minute or two its copy fills the journal from its file, and the
   System area lists the alerts.

To roll back before the worker has copied an alert, drop the table `valo_operational_alerts`, which drops
its triggers, then the function `valo_operational_alert_guard()`. Once an alert is copied, keep the table:
it is the record of each alert raised and cleared.
