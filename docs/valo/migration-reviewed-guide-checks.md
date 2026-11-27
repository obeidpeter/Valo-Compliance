# Applying the reviewed guide checks migrations to the development database

`20261126043629_reviewed_guide_checks` and `20261126043631_reviewed_guide_check_guards` give the
reviewed route the development owner's check of a guide's sources, which decision 0018 requires before
a guide is released ([the reviewed route](../architecture/reviewed-route.md), part 2). They need the
replaced reviewed versions migration (`20261126041618_replaced_reviewed_versions`) first. They have not
been applied to the Replit development database yet. Apply both, in order.

- **The first** adds `valo_reviewed_guide_checks`, empty. Each row says that the development owner
  checked one prepared guide's official sources, through the captures it names. It names the prepared
  candidate, the guide and its version, the candidate's checksums and the capture of each source. Only
  the application's own login has any privilege on it.
- **The second** guards the table and uses it:
  - A check is recorded only for the development owner (`valo_manual_regulatory_owner`), at the time the
    database gives it. It is never changed or removed, and the table cannot be emptied. The table keeps
    a history digest, which starts empty.
  - It adds `valo_reviewed_guide_checked(uuid, text, jsonb)`. It answers, as its owner, whether the
    development owner checked that exact candidate's sources, through those captures, within the last
    day. The publisher's role may call it, and reads no check and no staff record itself. Customer
    requests may not call it.
  - It replaces `valo_hold_new_regulatory_release()`. A guide on the reviewed route now becomes
    published only with such a check. Before, it never did. Everything else the function does is
    unchanged.
- Neither changes a row.

**Without these migrations the route refuses every guide, as before.** Asking for the owner's check
fails because its table and function are missing, so a guide's reviews are not admitted and no guide is
released. The refusal is a database error instead of `OWNER_SOURCE_CHECK_REQUIRED`. Templates are not
affected.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the replaced reviewed versions migration:
   `SELECT pg_get_functiondef('valo_workspace_holds_template(text,text)'::regprocedure) LIKE '%later.version>v.version%'`
   is true, and `SELECT to_regclass('public.valo_reviewed_guide_checks')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126043629_reviewed_guide_checks.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126043631_reviewed_guide_check_guards.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_reviewed_guide_checks` is 0.
   - `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.valo_reviewed_guide_checks'::regclass AND NOT tgisinternal ORDER BY tgname`
     lists `valo_reviewed_guide_checks_digest`, `valo_reviewed_guide_checks_guard` and
     `valo_reviewed_guide_checks_no_truncate`.
   - `SELECT has_function_privilege('valo_content_publisher_dev', 'valo_reviewed_guide_checked(uuid,text,jsonb)', 'EXECUTE')`
     is true, and the same for `valo_workspace_scope` is false.
   - `SELECT pg_get_functiondef('valo_hold_new_regulatory_release()'::regprocedure) LIKE '%valo_reviewed_guide_checked%'`
     is true.
   - `SELECT count(*) FROM valo_history_digest_mismatches()` is 0.
5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back before any check is recorded:

1. Apply the definition of `valo_hold_new_regulatory_release()` from `20261122124112_manual_library.sql`
   again.
2. Drop the table `valo_reviewed_guide_checks`, which drops its triggers.
3. Drop the functions `valo_reviewed_guide_checked(uuid, text, jsonb)` and
   `valo_reviewed_guide_check_guard()`.
