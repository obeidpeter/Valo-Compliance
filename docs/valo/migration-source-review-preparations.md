# Applying the source review preparations migration to the development database

`20261125183409_source_review_preparations` lets a Content editor ask, from a row of review work, for
the next candidate of a held template or guide ([the source register](../architecture/source-register.md),
slice 4, ADM-003 and CMP-007). It needs the source review owners migration
(`20261125174829_source_review_owners`) first. It has not been applied to the Replit development
database yet.

- It adds `valo_source_review_preparations`: each request, who asked and when, where it stands, and what
  came of it. Its guard, `valo_guard_source_review_preparation()`:
  - takes a request only on open review work of a template or guide, and only from an active Content
    editor;
  - takes a request only as waiting and untried, and dates it itself;
  - never changes who asked, for which row or when, never changes a finished request, and never removes
    one.
- One request at a time waits or runs for a row (`valo_source_review_preparations_open`). A request is
  tried at most three times (`valo_source_review_preparations_attempts`), and what came of it must hang
  together (`valo_source_review_preparations_outcome`): a prepared candidate names its row in
  `valo_prepared_candidates`, a held one names its held version, and a stop says why.
- It changes no row, grant or role. The scoped role gets nothing on the new table.

**The worker gains a scheduled task, `preparations`.** It runs one request a minute: it takes a fresh
copy of the AI provider's terms, as `capture-provider-terms` does, and runs the template's or guide's
preparer with its mechanical checks. It calls no model and publishes nothing. A database whose worker
schedules were set up before this change gets the new task when the reviewed queue setup is run again:

```sh
VALO_DEV_QUEUE_MIGRATION=reviewed-synthetic-development pnpm --filter @workspace/api-server queue:apply-development
```

Until the migration is applied, the review queue shows no row as one a candidate can be prepared from,
asking for one answers "Apply the review preparation migration before preparing from review work.", and
the worker's task finds nothing to do.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the source review owners migration (there is a `valo_source_review_notes`
   table), and that there is no `valo_source_review_preparations` table.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125183409_source_review_preparations.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_source_review_preparations` is 0.
   - `SELECT count(*) FROM pg_trigger WHERE tgname = 'valo_guard_source_review_preparation'` is 1.
   - `SELECT count(*) FROM pg_indexes WHERE indexname = 'valo_source_review_preparations_open'` is 1.
5. Run the reviewed queue setup again, as above, so the worker's `preparations` task is scheduled.
6. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any request is made: drop the trigger `valo_guard_source_review_preparation`, the
function `valo_guard_source_review_preparation()` and the table `valo_source_review_preparations`. Once a
request exists, keep it: dropping it would lose who asked for which candidate and what came of it.
