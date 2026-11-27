# Applying the rule changes migration to the development database

`20261125084317_rule_changes` records why each released requirements-check rule version leaves the
check, who made the change and whom it affected ([rule changes](../architecture/rule-changes.md),
slice 1). It has not been applied to the Replit development database yet.

- It adds one table, `valo_rule_changes`. It holds one record for each version that is replaced or
  withdrawn:
  - the rule and its version;
  - whether it was replaced or withdrawn, and the version that replaced it;
  - the reason, of 20 to 1,000 characters;
  - who made the change, and when;
  - how many workspaces, saved results and tasks were made under that version.

  The scoped role has no privilege on it: no customer request reads it yet.
- It adds three functions, each with a fixed search path, and their triggers:
  - `valo_rule_change_immutable()` refuses any change, deletion or truncation of a record;
  - `valo_rule_change_record()` runs before a record is written, as its owner. It refuses a record for
    a version that is not published. It sets the record's time to its transaction's, and counts the
    workspaces, saved results and live tasks made under that version, whatever the insert named;
  - `valo_rule_change_required()` runs after a change to `valo_rule_releases.status`, as its owner. It
    refuses a move from published to superseded or withdrawn unless that version's record was written
    in the same transaction. A replaced version's record must name a version of the same rule that is
    published by then.
- It changes no existing row.

**The application code depends on this migration** for every rule change. Until it is applied:
- the owner's panel cannot sign a version that replaces a released one, or withdraw one: each fails
  with a database error;
- the reviewed route's release command fails the same way for a version that replaces one.

The first sign-off of a rule, and the requirements check itself, still work.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the edition notices migration: the table `valo_edition_notices` exists,
   and the table `valo_rule_changes` does not.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125084317_rule_changes.sql
   ```

4. Check that these return what follows:
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_rule_changes', 'SELECT')` is false.
   - `SELECT count(*) FROM pg_trigger WHERE tgname IN ('valo_rule_change_immutable', 'valo_rule_change_no_truncate', 'valo_rule_change_record', 'valo_rule_change_required')`
     is 4.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

Versions replaced or withdrawn before the migration have no records.

To roll back, drop the four triggers, the three functions and the table. The records are lost with
the table. Keep a copy first if they are needed.
