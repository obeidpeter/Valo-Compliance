# Applying the manual regulatory words migration to the development database

`20261125112436_manual_regulatory_words` lets a published regulatory guide stay shown while a web
page among its sources returns different bytes with the same words
([keeping published guidance current](../architecture/guidance-currency.md), slice 1). It has not been
applied to the Replit development database yet.

- It adds one column, `valo_manual_regulatory_checks.words_sha256`: each check's evidence with each
  web page's words in place of its bytes. It may be empty, and a check constraint,
  `valo_manual_regulatory_words`, allows only a lower-case SHA-256 in it.
- It changes no existing row. A check recorded before it has no evidence in words.

**The application code depends on this migration to record a source check.** Until it is applied,
the owner's "Refresh the official sources" and `guidance:check-manual-sources` fail, and published
guides keep showing on their last check, as before. The reader does not depend on it: it reads the
column only where it exists, and otherwise compares bytes alone.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the rule change notices migration: the table `valo_rule_notices`
   exists, and the column `valo_manual_regulatory_checks.words_sha256` does not.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125112436_manual_regulatory_words.sql
   ```

4. Check that these return what follows:
   - `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'valo_manual_regulatory_checks' AND column_name = 'words_sha256'`
     is `YES`.
   - `SELECT count(*) FROM pg_constraint WHERE conname = 'valo_manual_regulatory_words'` is 1.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

A guide signed before the migration is shown as before, on its evidence in bytes. Once its owner
signs it again, its check has evidence in words too, and a web page's changed bytes no longer hold
it.

To roll back, drop the constraint and the column. The checks keep their evidence in bytes, and the
reader goes back to comparing bytes alone.
