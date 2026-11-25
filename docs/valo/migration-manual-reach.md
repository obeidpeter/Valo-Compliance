# Applying the manual reach migration to the development database

`20261125134530_manual_reach` lets the staff library show whom a template's withdrawal will tell before it
is made ([holding, withdrawing and reporting staff-library entries](../architecture/library-holds.md),
slice 1, ADM-007). It needs the manual changes migration (`20261125132218_manual_changes`) first. It has not
been applied to the Replit development database yet.

- It adds one function, `valo_manual_edition_reach(uuid)`: each workspace a library edition reaches, once,
  with whether it bought the template and how many documents it made from that edition. A workspace bought
  it if it holds an active entitlement to any edition of the entry, under a verified order. The function is
  not granted to customer requests.
- It replaces `valo_note_library_edition()` so that the notices of a replaced or withdrawn edition are
  written from the rows that function gives. The rows are those the notices were written from before, so
  the same workspaces are told, with the same counts. Its trigger stays as it was.
- It changes no existing row and no notice already written.

**The application code depends on this migration** for the counts only: the staff library reads them only
where the function exists, and otherwise shows none. Withdrawals and their notices work either way.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the manual changes migration: the table `valo_manual_changes` exists, and
   `SELECT to_regprocedure('public.valo_manual_edition_reach(uuid)')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125134530_manual_reach.sql
   ```

4. Check that these return what follows:
   - `SELECT to_regprocedure('public.valo_manual_edition_reach(uuid)') IS NOT NULL` is true.
   - `SELECT has_function_privilege('valo_workspace_scope', 'public.valo_manual_edition_reach(uuid)', 'EXECUTE')`
     is false.
   - `SELECT prosrc LIKE '%valo_manual_edition_reach%' FROM pg_proc WHERE proname = 'valo_note_library_edition'`
     is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back:
1. Recreate `valo_note_library_edition()` from `20261125132218_manual_changes.sql`.
2. Drop the function `valo_manual_edition_reach(uuid)`. The staff library then shows no counts, and the
   notices already written stay as they are.
