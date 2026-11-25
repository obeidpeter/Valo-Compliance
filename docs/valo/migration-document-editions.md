# Applying the document editions migration to the development database

`20261125005307_document_editions` lets a workspace see where the staff-library edition behind each of
its documents stands now: still the template's release, replaced by a later one, or withdrawn
([editions](../architecture/editions.md), slice 1). It has not been applied to the Replit development
database yet.

- It adds one function, `valo_workspace_document_editions()`, that runs as the table's owner. A
  customer request calls it, since it cannot read the staff library's table. For each of the scoped
  workspace's documents copied or started from a staff-library edition, it gives that edition and the
  latest edition of the same template that was ever released, with its state. It returns nothing
  outside a workspace's scope, and only the scoped role may call it.
- It changes no table, row or existing grant.

**The application code depends on this migration for the documents list and the editor.** Both read
where their documents' editions stand. Until it is applied, that read fails with a database error, and
the documents list and the editor show no notice of a replaced or withdrawn edition. The documents
themselves are unaffected. The public pages and the staff library do not need it.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the library saves and copies migration (`valo_documents` has a
   `library_edition` column), and that the function `valo_workspace_document_editions` does not exist.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125005307_document_editions.sql
   ```

4. Check that `SELECT has_function_privilege('valo_workspace_scope', 'valo_workspace_document_editions()', 'EXECUTE')`
   is true, and that `SELECT count(*) FROM valo_workspace_document_editions()` is 0 outside a workspace's scope.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, drop the function. Nothing else depends on it in the database, and no row records it.
