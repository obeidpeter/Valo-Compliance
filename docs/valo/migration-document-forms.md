# Applying the document form migration to the development database

`20261124175837_document_forms` lets a business document record the form it was started from
([forms v2](../architecture/forms-v2.md), slice 5). It has not been applied to the Replit development
database yet, and it needs the staff library's form text migration
([migration-manual-form-text.md](migration-manual-form-text.md)) applied first.

- It adds three columns to `valo_documents`, empty for every existing document: `form_version`,
  `form_edition` (the staff-library edition whose form text the document fills) and `form_digest`
  (that text's SHA-256). They are all set or all empty (`valo_document_form`).
- A trigger, `valo_guard_document_form`, accepts a form record only from a published free template
  edition whose form text has that exact SHA-256, and refuses any later change to the record. It runs
  as its owner, since the scoped role cannot read the editorial table.
- Two functions answer for the workspace a transaction is scoped to and for nothing else; only the
  scoped role `valo_workspace_scope` may call them:
  - `valo_free_form_edition(title)`: the most recently released free edition of a template, by its
    registered title, that has form text;
  - `valo_document_form_text(document)`: the edition one of the workspace's own documents was started
    with, and its form text, whatever has happened to the edition since.
- It changes no existing row, grant or role.

**The application code depends on this migration for every document route.** The documents list,
the editor and saving read the new columns. Until it is applied, those routes fail because the
columns are missing.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the form text migration (`valo_manual_library` has a `form_text`
   column) and that `valo_documents` has no `form_edition` column.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261124175837_document_forms.sql
   ```

4. Check that `SELECT count(*) FROM valo_documents WHERE form_edition IS NOT NULL` is 0, that
   `SELECT to_regprocedure('public.valo_free_form_edition(text)')` and
   `SELECT to_regprocedure('public.valo_document_form_text(uuid)')` name the functions, and that
   `SELECT has_function_privilege('valo_workspace_scope', 'public.valo_document_form_text(uuid)', 'EXECUTE')`
   is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any form document is started: drop the trigger and its function, the two read
functions, the constraint `valo_document_form`, the foreign key on `form_edition`, and the three
columns. Once a document records its form, keep them: dropping them would lose which edition a
customer's document fills.
