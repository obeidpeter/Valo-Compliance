# Applying the reconciliation attempt time migration to the development database

`20261127191526_reconciliation_attempt_time` gives each daily payment check the time the provider last
gave no answer for it ([reconciliation](../architecture/reconciliation.md), slice 1). It needs the
order price book guard migration (`20261127172934_order_price_book_guard`) first, in the journal's
order. It has not been applied to the Replit development database yet.

- **It adds one column**, `last_attempt_at` (a time, empty by default), to
  `valo_payment_reconciliations`.
- **It changes no row and no privilege.** Every check keeps what it held, with the new column empty. A
  customer's request may read the column, as it may read the rest of a check, and write none of it.
- **It adds no table, index, function or trigger.**

**The application code depends on this migration.** Three readers of the table name every column it
has, the new one among them. Until it is applied, each of them fails because the column is missing:

- **A customer's data download.** It lists the workspace's checks with its other records, so every
  download fails, for every workspace.
- **The finance area of the staff console.** It lists the latest checks beside the orders and the refund
  requests.
- **The daily check**, with a Paystack test merchant configured. It makes the day's checks, then stops
  before it tries any. Without a merchant it does nothing, as before.

So apply this migration before the code, or together with it. Nothing else needs it.

**After it, a check from before keeps its finding.** One that reads
`VERIFICATION_OR_FULFILMENT_DIFFERENCE` and needs review raises the new alert,
`PAYMENT_DIFFERENCES_DETECTED`, until a later check of the same order matches.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the order price book guard and has no attempt time yet:
   `SELECT to_regprocedure('public.valo_order_made_from_price_book()')` is not null, and
   `SELECT count(*) FROM information_schema.columns WHERE table_name = 'valo_payment_reconciliations'
   AND column_name = 'last_attempt_at'` is 0.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127191526_reconciliation_attempt_time.sql
   ```

4. Check that these return what follows:
   - `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name =
     'valo_payment_reconciliations' AND column_name = 'last_attempt_at'` is `timestamp with time zone`,
     `YES`.
   - `SELECT count(*) FROM valo_payment_reconciliations WHERE last_attempt_at IS NOT NULL` is 0.
   - `SELECT has_column_privilege('valo_workspace_scope', 'valo_payment_reconciliations',
     'last_attempt_at', 'UPDATE')` is false.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, drop the column: `ALTER TABLE public.valo_payment_reconciliations DROP COLUMN
last_attempt_at;`. The code of this slice then fails as described above, so roll it back with the
column.
