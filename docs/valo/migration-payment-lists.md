# Applying the payment lists migration to the development database

One migration lets the worker read Paystack's own list of each day's successful payments, once a day, and
keep what each reading found ([reconciliation](../architecture/reconciliation.md), slice 3b). It needs the
payment event settlement guard migration (`20261127203554_payment_event_settlement_guard`) first, in the
journal's order. It has not been applied to the Replit development database yet.

- **`20261127231133_payment_lists`** adds one empty table, `valo_payment_lists`: a row for each UTC
  day, with whether it is listed or waits for finance, its attempts and when the last was, the pages read,
  the payments the list held and those that matched no order, and why the day waits, if it does. Its key is
  the day (`valo_payment_lists_pkey`), and it checks that the day is written as YYYY-MM-DD
  (`valo_payment_lists_day_check`), that its status is one of three
  (`valo_payment_lists_status_check`), and that it has three attempts at most
  (`valo_payment_lists_attempts_check`).
- **It changes no row and grants nothing.** A customer's request has no access to the new table. No other
  table changes: what the list finds is recorded in `valo_payment_events`, as it is.

**Without it, the rest works as before**, except the reading of the list. With a Paystack test merchant
configured, the worker's `paymentReconciliation` task then fails each minute, after the daily checks of
Valo's own orders have run, and the worker reports that task as failing until the migration is applied.
Without a test merchant, nothing reads the table. Apply the migration before the code, or together with it.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the payment event settlement guard and has no listings table yet:
   `SELECT to_regprocedure('public.valo_payment_event_settlement_kept()')` is not null, and
   `SELECT to_regclass('public.valo_payment_lists')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file inside a transaction of its own, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127231133_payment_lists.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_payment_lists` is 0.
   - `SELECT conname FROM pg_constraint WHERE conrelid = 'public.valo_payment_lists'::regclass ORDER BY
     conname` is `valo_payment_lists_attempts_check`, `valo_payment_lists_day_check`,
     `valo_payment_lists_pkey` and `valo_payment_lists_status_check`.
   - `SELECT has_table_privilege('valo_workspace_scope', 'public.valo_payment_lists', 'SELECT')` is
     false.

5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, roll the code back first. Then `DROP TABLE public.valo_payment_lists;`, which removes the
record of which days were listed. The events a reading recorded stay in `valo_payment_events`, with their
settlements. Once the table is applied again, the worker records the day before alone, and lists it.
