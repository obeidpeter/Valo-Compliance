# Applying the order price book guard migration to the development database

`20261127172934_order_price_book_guard` makes the database check a new order against the price book
([order safety](../architecture/order-safety.md), slice 2). It needs the order terms guard migration
(`20261127152513_order_terms_guard`) first, in the journal's order, and the bundle order guards migration
(`20261126032944_bundle_order_guards`), whose function `valo_bundle_editions` it calls. It has not been
applied to the Replit development database yet.

- **It adds one function and one trigger**, `valo_order_made_from_price_book()` and
  `valo_orders_made_from_price_book`, on `valo_orders`. Before each insert of an order the trigger
  refuses the row unless the price, or the bundle's version, that it names is in effect, and its
  amount, currency and whole line are that offer's.
- **It changes no row and no privilege.** It adds no column, table or index.
- **Orders already in the table are not looked at.** One made before the guard stays as it is, whatever
  its line says.

**Without this migration, everything works as before.** The application already makes each order with
its price's own amount and line, so no code depends on the trigger. Only the code checks a new order
until it is applied.

**After it, a statement that makes an order with anything else fails**, with "An order is made from a
price in effect", "An order is made with the amount and the line its price gives", the same two for a
bundle, or "An order is made from a bundle whose templates each have a released edition".

- **An order made by hand has to be the price book's too.** A row inserted for a test or a demonstration
  needs a price in effect, and that price's amount, currency, title, edition, licence version, licence
  text and tax treatment in its line.
- **A copy of old rows into the table is checked row by row.** A full restore of a backup is not: it
  loads its rows before any trigger exists.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the order terms guard and has no price book guard yet:
   `SELECT to_regprocedure('public.valo_order_keeps_terms()')` is not null,
   `SELECT to_regprocedure('public.valo_bundle_editions(uuid)')` is not null, and
   `SELECT to_regprocedure('public.valo_order_made_from_price_book()')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127172934_order_price_book_guard.sql
   ```

4. Check that these return what follows:
   - `SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.valo_orders'::regclass AND tgname = 'valo_orders_made_from_price_book'`
     is `O`.
   - `SELECT has_function_privilege('public', 'public.valo_order_made_from_price_book()', 'EXECUTE')` is
     false.
   - Where the table has an order made from a price, this is refused with "An order is made with the
     amount and the line its price gives", or with "An order is made from a price in effect" if that
     price has closed, and adds nothing:

     ```sql
     BEGIN;
     INSERT INTO valo_orders (id, workspace_id, requested_by, reference, request_key, price_id, line, amount_kobo)
     SELECT gen_random_uuid(), workspace_id, requested_by, 'synthetic-check-' || gen_random_uuid(),
       gen_random_uuid(), price_id, line, amount_kobo + 1
     FROM valo_orders WHERE price_id IS NOT NULL LIMIT 1;
     ROLLBACK;
     ```

5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, drop the trigger and then the function:
`DROP TRIGGER valo_orders_made_from_price_book ON public.valo_orders; DROP FUNCTION public.valo_order_made_from_price_book();`
No data depends on either.
