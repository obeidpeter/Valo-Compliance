# Applying the library entry details migration to the development database

`20261124232729_library_entry_details` gives a staff-library template its **entry details**: what it
is for, what a customer needs to complete it, its limits, its related guides and whether AI drafted it
([library entries](../architecture/library-entries.md), slice 1). It has not been applied to the Replit
development database yet.

- It adds five columns to `valo_manual_library`: `purpose`, `needs`, `limits`, `related_items` and
  `ai_drafted`. Each is empty for every existing revision. Only a free or premium template may have
  them, within their limits (`valo_manual_entry_details`).
- It replaces the library's guard, `valo_guard_manual_revision()`, with the same function plus two
  changes. The new columns join those a saved revision can never change. And a template revision is
  released only when it says what it is for, its limits and whether AI drafted it.
- It changes no existing row, grant or role. A template already released stays released, without
  details, and can still be withdrawn or replaced. A draft saved before the migration must be saved
  again with its details before it can be released.

**The application code depends on this migration for the staff library.** Until it is applied, the
library's staff screens answer "Apply the editorial library migration before using the publisher.",
since they read the new columns. The site's public pages read the library without the new columns
until then, and show no details.

After it is applied, a Content editor can file the proposed details of the retained templates already
in the library with **File the proposed details** under *Drafts ready to file*. Each template then gets
a new draft version, to preview and release; filing releases nothing.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the export finished-files migration (`valo_export_jobs` has a `finished`
   column), and that `valo_manual_library` has no `purpose` column.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261124232729_library_entry_details.sql
   ```

4. Check that `SELECT count(*) FROM valo_manual_library WHERE purpose IS NOT NULL` is 0, and that
   `SELECT pg_get_functiondef('valo_guard_manual_revision()'::regprocedure) LIKE '%OLD.ai_drafted%'` is
   true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any details are saved: restore the guard from
`20261124171830_manual_form_text.sql`, then drop the constraint `valo_manual_entry_details` and the
five columns. Once a revision carries details, keep the columns: dropping them would lose what a
release said about its template.
