# Applying the staff library's form text migration to the development database

`20261124171830_manual_form_text` gives a staff-library template a place for its **form text**: the
template's wording with its placeholders named, which a fill-in form completes with a customer's
answers ([forms v2](../architecture/forms-v2.md), slice 4). It has not been applied to the Replit
development database yet.

- It adds one column, `valo_manual_library.form_text`, empty for every existing revision. Only a free
  or premium template may have it, of 1 to 60,000 characters (`valo_manual_form_text`).
- It replaces the library's guard, `valo_guard_manual_revision()`, with the same function plus the new
  column among those a saved revision can never change. A revision's form text is saved with it and
  released with it, by the same Content editor's publish, and stays as it was afterwards.
- It changes no existing row, grant or role. No customer role can read the column.

**The application code depends on this migration for the staff library.** Until it is applied, the
library's staff screens answer "Apply the editorial library migration before using the publisher.",
since they read the new column. The site's public pages, downloads, purchases and the owner's
regulatory sign-off do not read it and work as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the form purchase migration
   (`SELECT to_regprocedure('public.valo_workspace_holds_template(text,text)')` names the function) and
   that `valo_manual_library` has no `form_text` column.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261124171830_manual_form_text.sql
   ```

4. Check that `SELECT count(*) FROM valo_manual_library WHERE form_text IS NOT NULL` is 0, and that
   `SELECT pg_get_functiondef('valo_guard_manual_revision()'::regprocedure) LIKE '%OLD.form_text%'` is
   true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any form text is saved: restore the guard from
`20261122160736_manual_regulatory_source_signoff.sql`, then drop the constraint
`valo_manual_form_text` and the column. Once a revision carries form text, keep the column: dropping
it would lose released wording.
