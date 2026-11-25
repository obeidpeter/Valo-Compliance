# Applying the rule change notices migration to the development database

`20261125090832_rule_change_notices` tells each workspace when a requirements-check rule version it
saved a result under, or made a task from, is replaced or withdrawn, and marks its tasks for review at
once ([rule changes](../architecture/rule-changes.md), slice 2). It needs the rule changes migration
(`20261125084317_rule_changes`) first. It has not been applied to the Replit development database
yet.

- It adds one table, `valo_rule_notices`. It holds one notice per workspace, rule version and kind of
  change. Row security limits it to the workspace's own rows. The scoped role may read the notices and
  change only `read_at`.
- It adds one function and its trigger. `valo_note_rule_change()` runs after a change to
  `valo_rule_releases.status`, as its owner, with a fixed search path. When a published version is
  superseded or withdrawn with its change record, in the same transaction it:
  - writes one notice, with the change's reason, to each workspace that saved a result listing the
    version or made a live task from it, unless the workspace's data was erased;
  - calls off the unsent reminders of each live task made under the version, with the reason
    `SOURCE_NO_LONGER_ELIGIBLE`;
  - marks each such task for review, and records the mark in the workspace's event log as
    `service:rule-change`. A task is never deleted, and its dates are not changed.
- It changes no existing row.

**The application code depends on this migration** for the workspace's home: until it is applied, the
home's list of rule notices shows an error. Tasks made under a changed version are still marked for
review when the workspace's tasks are next read, as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the rule changes migration: the table `valo_rule_changes` exists, and
   the table `valo_rule_notices` does not.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125090832_rule_change_notices.sql
   ```

4. Check that these return what follows:
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_rule_notices', 'SELECT')` is true.
   - `SELECT has_column_privilege('valo_workspace_scope', 'valo_rule_notices', 'reason', 'UPDATE')`
     is false.
   - `SELECT count(*) FROM pg_trigger WHERE tgname = 'valo_note_rule_change'` is 1.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

Versions replaced or withdrawn before the migration get no notices: the trigger writes only for the
changes made after it.

To roll back, drop the trigger, its function and the table. The notices are lost with the table; the
tasks keep their marks.
