# Applying the library saves and copies migration to the development database

`20261125000142_library_saves_and_copies` lets a workspace save a staff-library template, be suggested
one, and copy a free one into a document ([library entries](../architecture/library-entries.md),
slices 2 and 3). It has not been applied to the Replit development database yet.

- It adds one column, `valo_documents.library_edition`, empty for every existing document, with its
  foreign key to `valo_manual_library` and a check that a copy has no form record and no reviewed
  template version (`valo_document_library_edition`).
- It adds a guard, `valo_guard_document_library_edition()`. A document records a release only from a
  released free template, when it is written, and never changes it.
- It adds three functions that run as the table's owner. A customer request calls them, since it
  cannot read the staff library's table. `valo_live_manual_templates()` gives the released templates as
  the library lists them. `valo_free_library_edition(uuid)` gives a released free template's text.
  `valo_workspace_library_editions()` gives the release each of the workspace's copies came from.
  Each returns nothing outside a workspace's scope, and only the scoped role may call them.
- It changes no existing row, and grants nothing else.

**The application code depends on this migration for every document route.** The documents list,
the editor, saving a document and the business library read the new column. Saving a template, the
saved list and the template copy route also call the new functions. Until it is applied, those
routes fail because the column and the functions are missing. The public pages and the staff
library do not need it.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the library entry details migration (`valo_manual_library` has a
   `purpose` column), and that `valo_documents` has no `library_edition` column.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125000142_library_saves_and_copies.sql
   ```

4. Check that `SELECT count(*) FROM valo_documents WHERE library_edition IS NOT NULL` is 0, and that
   `SELECT has_function_privilege('valo_workspace_scope', 'valo_live_manual_templates()', 'EXECUTE')` is
   true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any copy is made: drop the three functions, the trigger and its function, the
constraints `valo_document_library_edition` and `valo_documents_library_edition_valo_manual_library_id_fk`,
and the column. Once a document records a release, keep the column: dropping it would lose where the
copy came from.
