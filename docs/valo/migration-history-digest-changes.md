# Applying the history digest changes migrations to the development database

`20261126174547_history_digest_changes` and `20261126174600_history_digest_change_triggers` change how the
database keeps each history's digest ([audit trail](../architecture/audit-trail.md), slice 3; ADM-009).
Each write to a history used to update one of the history's sixteen digest rows and hold it until its
transaction ended, so two writers could wait on each other and end in a deadlock. Now each write adds its
change as a row of its own, which no other writer waits on, and the worker's hourly count folds the
changes into the digest's rows before it counts. They need the reviewer login migration
(`20261126160415_reviewer_login`) first, in the journal's order. They have not been applied to the Replit
development database yet. Apply both, in order.

- **The first** adds `valo_history_digest_changes`, empty. Customer requests have no privilege on it.
- **The second** has each history's digest trigger add its changes to that table instead of updating
  the digest's rows. Only a history's trigger adds a change; a change is never altered, and the table
  cannot be emptied with TRUNCATE. Removing changes folds them into `valo_history_digests` in the same
  statement, so every digest stays as it was. The count and the reseed read and fold both parts.
- Neither changes a history's row or a digest's row.

**Without these migrations, the digest works as before.** The hourly count finds no changes table and
folds nothing, and the alert reads its count as it does today. Two writers can still deadlock on the
digest's rows until the migrations are applied.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the reviewer login migration:
   `SELECT to_regrole('valo_reviewer_login')` is not null, and
   `SELECT to_regclass('public.valo_history_digest_changes')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup. Note what
   `SELECT * FROM valo_history_digest_mismatches()` returns.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126174547_history_digest_changes.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126174600_history_digest_change_triggers.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_history_digest_changes` is 0.
   - `SELECT * FROM valo_history_digest_mismatches()` returns what it returned in step 2.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_history_digest_changes', 'SELECT,INSERT,UPDATE,DELETE')`
     is false.
   - `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.valo_history_digest_changes'::regclass AND NOT tgisinternal ORDER BY 1`
     names `valo_history_digest_changes_added_only`, `valo_history_digest_changes_fold`,
     `valo_history_digest_changes_never_altered` and `valo_history_digest_changes_no_truncate`.
5. Resume writes and the worker. After the next write to a history, the table holds its change; after the
   worker's next hourly count, it is empty again and the count's result is unchanged.
6. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, in one transaction: put back the earlier `valo_history_digest_maintain`,
`valo_history_digest_mismatches` (both in `20261125230122_history_digest_triggers`) and
`valo_history_digest_reseed` (in `20261126001058_history_digest_reseed`), each with `CREATE OR REPLACE`;
then remove every change with `DELETE FROM valo_history_digest_changes`, which folds them into the
digest's rows; then drop the table `valo_history_digest_changes`, which drops its triggers, and the
functions `valo_history_digest_fold()` and `valo_history_digest_change_guard()`. Check that
`valo_history_digest_mismatches()` returns what it returned in step 2.
