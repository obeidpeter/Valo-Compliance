# Applying the price change log migration to the development database

`20261118013843_price_change_log` versions prices and logs every change to them (ADM-006). It
has not been applied to the Replit development database yet.

- It creates `valo_price_changes`: for each change to a price row, the price id, the action
  (`existing`, `created`, `closed` or `deleted`), the price row as it was after the change (or
  before a delete), the database role that made it and when. A trigger refuses any update or
  delete of the log, and truncating it is refused.
- Triggers on `valo_prices` make prices versioned. No column but `effective_to` ever changes
  in place (content version, title, amount, currency, licence, tax treatment, approval
  reference, start, and any column a later migration adds); a change of terms is a new row
  with its own effective dates. The only change to a row is closing it: setting
  `effective_to` once, to the moment of the change or later. Every insert, close and delete
  is logged. A price an order refers to still cannot be deleted.
- Each price that exists when the migration runs is logged once as `existing`, with the role
  `migration:20261118013843_price_change_log`. No other row is read or written.
- It grants nothing. Customer requests acting as `valo_workspace_scope` can neither read nor
  write the log, and they still may only lock price rows.

The application code does not depend on the migration. Before it, a price can still be edited
in place and nothing records the change; orders keep the amount and licence they were created
with either way.

After the migration, change a price like this, inside one transaction:

```sql
BEGIN;
UPDATE valo_prices SET effective_to = now() WHERE id = '<current price id>';
INSERT INTO valo_prices (id, content_version_id, title, amount_kobo, licence_version,
  licence_text, tax_treatment, approval_reference, effective_from)
VALUES (gen_random_uuid(), '<content version id>', '<title>', <amount in kobo>,
  '<licence version>', '<licence text>', '<tax treatment>', '<approval reference>', now());
COMMIT;
```

A customer-facing price still needs the owner's commercial approval; the approval reference
names it.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the security signals migration (`valo_security_signals`
   exists) and that `valo_price_changes` does not exist.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261118013843_price_change_log.sql
   ```

4. Check that `SELECT count(*) FROM valo_price_changes WHERE action = 'existing'` equals
   `SELECT count(*) FROM valo_prices`, and that
   `SELECT has_table_privilege('valo_workspace_scope', 'valo_price_changes', 'SELECT')`
   returns `false`.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.
