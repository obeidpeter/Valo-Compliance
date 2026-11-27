# Applying the finished-file migration to the development database

`20261124221556_export_finished_files` lets a file be made as a finished file, without the draft
notice, beside the marked draft of the same version ([finished-file.md](../architecture/finished-file.md)).
It has not been applied to the Replit development database yet, and it needs the premium form
document migration ([migration-premium-form-documents.md](migration-premium-form-documents.md))
applied first.

- It adds one column to `valo_export_jobs`, `finished`, false for every existing job: each file
  already asked for stays a marked draft.
- It rebuilds the unique index `valo_export_revision_format_unique` with the new column, so one
  finished file and one marked draft of the same version, format and render version may stand side
  by side, and no second of either.
- It changes no grant or role: the scoped role's table privileges on `valo_export_jobs` already cover
  the new column.

**The application code depends on this migration for every file route.** Asking for a file, listing a
document's files and the worker read the new column. Until it is applied, those routes fail because
the column is missing.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the premium form document migration (`valo_documents` has a
   `form_order` column) and that `valo_export_jobs` has no `finished` column.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261124221556_export_finished_files.sql
   ```

4. Check that `SELECT count(*) FROM valo_export_jobs WHERE finished` is 0, and that
   `SELECT indexdef FROM pg_indexes WHERE indexname = 'valo_export_revision_format_unique'` lists
   `finished` among its columns.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any finished file is asked for: drop the index, drop the column, and create the
index again on `(workspace_id, revision_id, format, render_version)`. Once a finished file has been
asked for, keep them: dropping the column would turn a finished file's record into a marked draft's.
