# Applying the privacy holds migrations to the development database

`20261126091824_privacy_holds` and `20261126091827_privacy_hold_guards` add a hold of its own on a
workspace, apart from any privacy request ([finishing a privacy request](../architecture/privacy-requests.md),
slice 4). While a hold stands, Valo's own deletion of the workspace's data stops. They need the consent
changes migrations (`20261126064724_consent_change_grants`) first. They have not been applied to the
Replit development database yet. Apply both, in order.

- **The first** adds `valo_privacy_holds`, empty, with row-level security. Each row names the workspace,
  why it is held, who placed it and when, and, once released, who released it, when and why. A
  workspace has at most one standing hold. Customer requests have no privilege on it.
- **The second** keeps each hold for good: its one change is its release, once, and a row is removed
  only with a synthetic test identity's workspace. The table cannot be emptied, and it keeps a history
  digest (ADM-009), which starts empty. It adds `valo_workspace_under_hold`, which a customer request may
  call to learn only whether its own workspace is held, never why.
- Neither changes a row.

**Without these migrations, nothing is held.** The staff privacy screen says "Holds cannot be placed
yet: a database update is waiting to be applied. Until it is, no workspace is held.", and placing or
releasing a hold answers 503. The erasure and the removal of old downloads go on as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the consent changes migrations:
   `SELECT to_regclass('public.valo_consent_changes')` is not null, and
   `SELECT to_regclass('public.valo_privacy_holds')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126091824_privacy_holds.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126091827_privacy_hold_guards.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_privacy_holds` is 0.
   - `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.valo_privacy_holds'::regclass` is true.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_privacy_holds', 'SELECT')` is false.
   - `SELECT has_function_privilege('valo_workspace_scope', 'valo_workspace_under_hold(uuid)', 'EXECUTE')`
     is true, and the same for `public` is false.
   - `SELECT * FROM valo_history_digest_mismatches()` does not name `valo_privacy_holds`.
5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back before any hold is placed, drop the function `valo_workspace_under_hold(uuid)`, then the
table `valo_privacy_holds`, which drops its policy and triggers, then the function
`valo_privacy_hold_guard()`. Once a hold is placed, keep the table: it is the record of each hold, who
placed and released it, and why.
