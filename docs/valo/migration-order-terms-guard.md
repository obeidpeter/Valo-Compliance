# Applying the order terms guard migration to the development database

`20261127152513_order_terms_guard` makes the database keep the terms an order was made with
([order safety](../architecture/order-safety.md), slice 1). It needs the bundle orders migrations
(`20261126032901_bundle_orders` and `20261126032944_bundle_order_guards`) first, in the journal's order,
since it reads an order's `bundle_id`. It has not been applied to the Replit development database yet.

- **It adds one function and one trigger**, `valo_order_keeps_terms()` and `valo_orders_keep_terms`, on
  `valo_orders`. Before each update of an order the trigger refuses a change to its amount, currency,
  line, price, bundle, workspace, reference, request key, creation time or id. It refuses a change to
  who placed it unless the new value is `privacy-erased`, which an erasure writes.
- **It changes no row and no privilege.** It adds no column, table or index.
- **An order's status, provider transaction, checkout address and last check change as before.**

**Without this migration, everything works as before.** The application never changes what the trigger
keeps, so no code depends on it. Only the code keeps an order's terms until it is applied.

**After it, a statement that changes an order's terms fails**, with "An order keeps the offer, the line
and the amount it was made with" or "An order keeps who placed it, until an erasure removes them". If a
row of `valo_orders` has to be corrected by hand, that is a finance decision with its own record. The
trigger is not turned off for it without one.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the bundle orders migrations and has no guard yet:
   `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'valo_orders' AND column_name = 'bundle_id'`
   is 1, and `SELECT to_regprocedure('public.valo_order_keeps_terms()')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127152513_order_terms_guard.sql
   ```

4. Check that these return what follows:
   - `SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.valo_orders'::regclass AND tgname = 'valo_orders_keep_terms'`
     is `O`.
   - `SELECT has_function_privilege('public', 'public.valo_order_keeps_terms()', 'EXECUTE')` is false.
   - Where the table has a row, this is refused with the first sentence above, and changes nothing:
     `BEGIN; UPDATE valo_orders SET amount_kobo = amount_kobo + 1; ROLLBACK;`
   - Where the table has a row, this succeeds and changes nothing:
     `BEGIN; UPDATE valo_orders SET status = status; ROLLBACK;`
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, drop the trigger and then the function:
`DROP TRIGGER valo_orders_keep_terms ON public.valo_orders; DROP FUNCTION public.valo_order_keeps_terms();`
No data depends on either.
