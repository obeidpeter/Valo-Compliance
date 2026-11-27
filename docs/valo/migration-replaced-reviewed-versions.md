# Applying the replaced reviewed versions migration to the development database

`20261126041618_replaced_reviewed_versions` replaces one function,
`valo_workspace_holds_template(text, text)`. The premium forms ask it whether the scoped workspace holds
a template ([the reviewed route](../architecture/reviewed-route.md), part 1). It needs the order terms
migration (`20261126023013_order_terms`) first. It has not been applied to the Replit development
database yet.

- On the reviewed route, the function now counts only a version that is not replaced. A version is
  replaced once a later version of the same template has been released, whether that later version is
  still published or was withdrawn since. So a purchase carries to the template's latest release under
  the rule its order recorded. An order that covers only the version it bought holds nothing once that
  version is replaced.
- The staff library's half of the function is unchanged. It keeps its owner, its fixed search path and
  its privileges: only the customer role may call it.
- It changes no row.

**The application code does not depend on this migration.** Without it, the reviewed route still closes
a replaced version's file and refuses a new document from it. Only the premium forms' own check of a
reviewed template keeps counting a replaced version until it is applied.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the order terms migration: the function `valo_order_terms_hold` exists.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126041618_replaced_reviewed_versions.sql
   ```

4. Check that these return what follows:
   - `SELECT pg_get_functiondef('valo_workspace_holds_template(text,text)'::regprocedure) LIKE '%later.version>v.version%'`
     is true.
   - `SELECT has_function_privilege('valo_workspace_scope', 'valo_workspace_holds_template(text,text)', 'EXECUTE')`
     is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, apply the function's definition from `20261126023013_order_terms.sql` again.
