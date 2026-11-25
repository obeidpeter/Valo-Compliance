# Applying the edition notices migration to the development database

`20261125012048_edition_notices` tells each workspace that bought or used a template's edition when
that edition is replaced or withdrawn ([editions](../architecture/editions.md), slice 3). It has not
been applied to the Replit development database yet.

- It adds two tables.
  - `valo_edition_notices` holds one notice per workspace, edition and kind of change. Row security
    limits it to the workspace's own rows. The scoped role may read the notices and change only
    `read_at`.
  - `valo_manual_withdrawals` holds the reason a staff-library edition was withdrawn, of 20 to 1,000
    characters. Its guard, `valo_guard_manual_withdrawal()`, refuses any change or deletion.
- It adds two triggers whose functions run as their owner, with a fixed search path. Each writes the
  notices in the transaction that makes the change, whoever makes it.
  - `valo_note_library_edition()` runs after a change to `valo_manual_library.state`. It writes when
    a template's edition is withdrawn, and when a new edition is released after a replaced or
    withdrawn one.
  - `valo_note_reviewed_edition()` runs after a change to `valo_content_versions.status`. It writes
    when a template's next version is published.
  - Each notice goes to the workspaces that hold the template through an active, verified purchase,
    or made a document from that edition.
- It drops and recreates `valo_workspace_document_editions()` so that it also returns the reason the
  latest edition was withdrawn: a function's columns cannot change in place. Only the scoped role may
  call it, as before.
- It changes no existing row.

**The application code depends on this migration** for two things:

- the staff library's withdrawal, which records its reason;
- the workspace's home, which lists the notices.

Until it is applied, a withdrawal from the staff library fails with a database error, and the home's
list of notices shows an error. The document editions read still works, without the reason.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the edition purchases migration: the function
   `valo_workspace_carried_editions` exists, and the table `valo_edition_notices` does not.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125012048_edition_notices.sql
   ```

4. Check that these return what follows:
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_edition_notices', 'SELECT')` is true.
   - `SELECT has_column_privilege('valo_workspace_scope', 'valo_edition_notices', 'title', 'UPDATE')`
     is false.
   - `SELECT count(*) FROM pg_trigger WHERE tgname IN ('valo_note_library_edition', 'valo_note_reviewed_edition', 'valo_guard_manual_withdrawal')`
     is 3.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

Editions replaced or withdrawn before the migration get no notices: the triggers write only for the
changes made after them.

To roll back:

1. Drop the three triggers and their functions, and the two tables.
2. Restore `valo_workspace_document_editions()` from `20261125005307_document_editions.sql`, with its
   grant.

The reasons recorded for withdrawals are lost with the table. Keep a copy first if they are needed.
