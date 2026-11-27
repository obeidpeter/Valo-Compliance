# Applying the manual holds migration to the development database

`20261125140207_manual_holds` lets staff hold the published version of a staff-library entry short of a
withdrawal ([holding, withdrawing and reporting staff-library entries](../architecture/library-holds.md),
slice 2, ADM-007 and EDP-011). It needs the manual reach migration (`20261125134530_manual_reach`) first.
It has not been applied to the Replit development database yet.

- It adds two tables. `valo_manual_holds` keeps each hold: the version, why, who placed it, when, and how
  many workspaces its template reached then. `valo_manual_hold_lifts` keeps each lifting: why, who lifted
  it and when.
- Their triggers, `valo_guard_manual_hold()` and `valo_guard_manual_hold_lift()`, accept a hold only of a
  published version without an open hold, from an active Content editor or, for a regulatory guide, the
  development owner. They accept a lifting from an active Content editor, except for a regulatory guide's
  hold, which only the development owner lifts. Each dates its record itself, and neither record is ever
  changed or removed.
- It adds `valo_manual_edition_held(uuid)`, whether a version has a hold not yet lifted. It is not granted
  to customer requests; the functions they call read it as their owner.
- It replaces four customer functions so that a held version leaves new use as an overdue one does:
  `valo_live_manual_templates()` (saving and suggestions), `valo_free_library_edition(uuid)` (copying),
  `valo_free_form_edition(text)` (starting a form) and `valo_live_manual_premium_versions(uuid)`, which now
  gives a held premium edition as held, so that it is not offered, ordered or priced while its buyers keep
  their files.
- It changes no existing row. Nothing is held until staff hold it.

**The application code depends on this migration** for holding and lifting only: until it is applied the
staff library refuses a hold and shows none. The public pages, downloads and offers read holds only where
the function exists, and otherwise work as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the manual reach migration: `SELECT
   to_regprocedure('public.valo_manual_edition_reach(uuid)')` is not null, and the table
   `valo_manual_holds` does not exist.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125140207_manual_holds.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM pg_trigger WHERE tgname IN ('valo_guard_manual_hold', 'valo_guard_manual_hold_lift')`
     is 2.
   - `SELECT (SELECT count(*) FROM valo_manual_holds) + (SELECT count(*) FROM valo_manual_hold_lifts)` is 0.
   - `SELECT has_function_privilege('valo_workspace_scope', 'public.valo_manual_edition_held(uuid)', 'EXECUTE')`
     is false.
   - `SELECT count(*) FROM pg_proc WHERE proname IN ('valo_live_manual_templates', 'valo_free_library_edition',
     'valo_free_form_edition', 'valo_live_manual_premium_versions') AND prosrc LIKE '%valo_manual_edition_held%'`
     is 4.
   - `SELECT has_function_privilege('valo_workspace_scope', 'public.valo_live_manual_premium_versions(uuid)', 'EXECUTE')`
     is still true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back:
1. Recreate the four customer functions from `20261125122001_manual_reviews.sql`, and grant
   `valo_live_manual_premium_versions(uuid)` to `valo_workspace_scope` again as that file does.
2. Drop the triggers `valo_guard_manual_hold_lift` and `valo_guard_manual_hold`, their functions, and
   `valo_manual_edition_held(uuid)`.
3. Drop `valo_manual_hold_lifts`, then `valo_manual_holds`. The holds and their liftings are lost with the
   tables, and every version they held is in use again.
