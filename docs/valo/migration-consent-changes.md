# Applying the consent changes migrations to the development database

`20261126064714_consent_changes` and `20261126064724_consent_change_grants` keep each change to a
workspace's optional choices, marketing messages and task reminders, with the version of the privacy
notice in force ([the processing inventory](../architecture/processing-inventory.md), slice 4). They
need the reviewed guide check guards migration (`20261126043631_reviewed_guide_check_guards`) first.
They have not been applied to the Replit development database yet. Apply both, in order.

- **The first** adds `valo_consent_changes`, empty, with row-level security that limits a customer
  request to its own workspace's rows. Each row names the workspace, the choice (`marketing` or
  `reminders`), what was chosen, the privacy notice's version and who made the change, and the database
  adds the time.
- **The second** lets customer requests add a row and read their own. They cannot change or remove one.
- Neither changes a row.

**Without these migrations, a changed choice is refused.** Saving the business profile with the
marketing choice changed, or turning reminders on or off, answers 503: "This choice cannot be saved
yet: a database update is waiting to be applied. Nothing was changed." A profile saved with the
marketing choice as it was, and reminder timings changed while reminders stay on, save as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the reviewed guide check guards migration:
   `SELECT to_regclass('public.valo_reviewed_guide_checks')` is not null, and
   `SELECT to_regclass('public.valo_consent_changes')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126064714_consent_changes.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126064724_consent_change_grants.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_consent_changes` is 0.
   - `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.valo_consent_changes'::regclass` is true.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_consent_changes', 'INSERT')` is true, and
     the same for `UPDATE` and `DELETE` is false.
5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back before any change is recorded, drop the table `valo_consent_changes`, which drops its
policy and grants. Once a change is recorded, keep the table: it is the record of what each person
chose.
