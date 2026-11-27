# Applying the acceptance runs migration to the development database

`20261125201543_acceptance_runs` keeps a suite's run for an independent reviewer, and binds a reviewer's
decision on a run outcome to the case as kept ([the reviewer's record](../architecture/reviewer-record.md),
slice 2, decision 0016, for EDP-010, RUL-008 and AI-008). It needs the acceptance reviews migration
(`20261125191813_acceptance_reviews`) first. It has not been applied to the Replit development database
yet.

- It adds `valo_acceptance_runs`: one row per kept run, with the corpus, the hash of the corpus file, a
  short summary, every case with the suite's own status and what it left for a reviewer, the hash of
  the cases and the operator who kept it. Its guard, `valo_guard_acceptance_run()`:
  - takes a run only when each case names the case, its hash, its status, its review (or none) and the
    hash of the case as kept, and names each case once;
  - dates the run itself, and never changes or removes one; `valo_acceptance_runs_no_truncate` refuses a
    truncate.
- It replaces `valo_guard_acceptance_review()`, the guard on decisions. A decision on a run outcome is
  now taken only on a case that a kept run of the same corpus left for a reviewer, with the case's hash
  and the hash of the case as kept. A decision on an expected outcome is taken as before.
- It changes no row and no grant. The scoped role gets nothing on the new table.

**Keeping a run.** Each suite's command keeps its run when it is given `--keep-for-review=<operator>`,
where the operator is a label of 3 to 80 letters, digits or `. _ @ -`:

```sh
NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/checker-corpus-run.ts --keep-for-review=<operator>
```

The editorial suite (`src/scripts/editorial-source-suite.ts`) and the customer AI suite
(`src/scripts/customer-source-suite.ts`) take the same option. None of them calls a model to keep a run:
the customer AI suite keeps only the answers its evaluation identity already has, unless it is run with
its own provider settings, which need the owner's AI budget.

Until the migration is applied, the acceptance cases page's kept run answers "Apply the acceptance runs
migration before reading kept runs.", and the commands' `--keep-for-review` fails.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the acceptance reviews migration (there is a `valo_acceptance_reviews`
   table), and that there is no `valo_acceptance_runs` table.
2. Check that no decision on a run outcome exists, since none could be bound to a kept run. This returns
   0:

   ```sql
   SELECT count(*) FROM valo_acceptance_reviews WHERE judgment = 'run_outcome';
   ```

3. Pause writes and the worker. Take a fresh encrypted backup.
4. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125201543_acceptance_runs.sql
   ```

5. Check that these return what follows:
   - `SELECT count(*) FROM valo_acceptance_runs` is 0.
   - `SELECT count(*) FROM pg_trigger WHERE tgname IN ('valo_guard_acceptance_run', 'valo_acceptance_runs_no_truncate')` is 2.
   - `SELECT prosrc LIKE '%valo_acceptance_runs%' FROM pg_proc WHERE proname = 'valo_guard_acceptance_review'`
     is true.
6. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any run is kept: drop the triggers `valo_acceptance_runs_no_truncate` and
`valo_guard_acceptance_run`, the function `valo_guard_acceptance_run()` and the table
`valo_acceptance_runs`, and restore `valo_guard_acceptance_review()` from
`20261125191813_acceptance_reviews.sql`. Once a run is kept, keep it: a decision on it is bound to it.
