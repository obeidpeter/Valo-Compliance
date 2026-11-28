# Applying the payment check settlement migrations to the development database

Two migrations let finance settle a difference a daily payment check found, and keep a finished check as
it is ([reconciliation](../architecture/reconciliation.md), slice 2). They need the reconciliation attempt
time migration (`20261127191526_reconciliation_attempt_time`) first, in the journal's order. Neither has
been applied to the Replit development database yet.

- **`20261127194336_payment_check_settlements`** adds three columns to `valo_payment_reconciliations`:
  `outcome`, `resolved_by` and `resolved_at`, empty for every check. It lets a check's status be
  `resolved`, and adds two checks of its own: a settled check has an outcome, who settled it and when,
  and an unsettled one has none (`valo_payment_reconciliations_resolution_check`); an outcome is
  `explained` or `no_payment_stands` (`valo_payment_reconciliations_outcome_check`).
- **`20261127194345_payment_check_guard`** adds one function and one trigger,
  `valo_payment_check_kept()` and `valo_payment_checks_kept`, before each update of a check. A waiting
  check changes only as the daily check finishes it. A finished one never changes, save that finance
  settles a difference once, with its reason recorded in the staff access audit in the same transaction,
  and that an erasure rewrites its finding.
- **They change no row and no privilege.** A customer's request may read the new columns, as it may read
  the rest of a check, and write none of them.

**The application code depends on the first migration.** Three readers of the table name every column it
has. Until it is applied, each of them fails because the columns are missing: a customer's data download,
for every workspace; the finance area of the staff console; and the daily check, with a Paystack test
merchant configured. The finance area's payment checks, and the second look before an order, read the
new columns too. Apply both migrations before the code, or together with it.

**After them, a statement that changes a finished check fails**, with "A finished payment check is never
changed, save that finance settles a difference once", "A payment check is settled only by finance, with
the reason recorded as it is settled", or "A payment check keeps the order and the day it is about". A
correction by hand to a check is refused: settle it from the finance area instead.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the reconciliation attempt time migration and has neither of these yet:
   `SELECT count(*) FROM information_schema.columns WHERE table_name = 'valo_payment_reconciliations'
   AND column_name IN ('last_attempt_at', 'outcome')` is 1, and
   `SELECT to_regprocedure('public.valo_payment_check_kept()')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file inside a transaction of its own, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127194336_payment_check_settlements.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127194345_payment_check_guard.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_payment_reconciliations WHERE outcome IS NOT NULL OR resolved_by IS NOT
     NULL OR resolved_at IS NOT NULL` is 0.
   - `SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.valo_payment_reconciliations'::regclass AND
     tgname = 'valo_payment_checks_kept'` is `O`.
   - `SELECT has_function_privilege('public', 'public.valo_payment_check_kept()', 'EXECUTE')` is false.
   - Where the table has a finished check, this is refused with "A finished payment check is never
     changed", and changes nothing:

     ```sql
     BEGIN;
     UPDATE valo_payment_reconciliations SET attempts = attempts
     WHERE id = (SELECT id FROM valo_payment_reconciliations WHERE status <> 'pending' LIMIT 1);
     ROLLBACK;
     ```

5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, roll the code back first. Then drop the trigger and the function, and then the checks and
the columns:
`DROP TRIGGER valo_payment_checks_kept ON public.valo_payment_reconciliations; DROP FUNCTION
public.valo_payment_check_kept();`, then `ALTER TABLE public.valo_payment_reconciliations DROP CONSTRAINT
valo_payment_reconciliations_resolution_check, DROP CONSTRAINT valo_payment_reconciliations_outcome_check,
DROP COLUMN outcome, DROP COLUMN resolved_by, DROP COLUMN resolved_at;` and the status check put back as
`CHECK (status IN ('pending', 'matched', 'needs_review'))`, which refuses to return while any check is
settled.
