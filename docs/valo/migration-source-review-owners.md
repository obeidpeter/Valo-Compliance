# Applying the source review owners migration to the development database

`20261125174829_source_review_owners` lets review work reach its owner ([the source
register](../architecture/source-register.md), slice 3, ADM-008 and CMP-007). It needs the source watch
stops migration (`20261125171850_source_watch_stops`) first. It has not been applied to the Replit
development database yet.

- It adds `withdrawn` to the ways a row of `valo_source_review_work` can close
  (`valo_source_review_work_status_check`).
- It adds `valo_source_review_notes`: what was checked on a row, who recorded it and when. Its guard,
  `valo_guard_source_review_note()`, takes a note only on open work, only from an active Content editor
  or the development owner, and in 20 to 1,000 characters (`valo_source_review_notes_note`). It dates
  each note itself and never changes or removes one.
- It closes the review work that a release or a withdrawal already settled:
  - on a version withdrawn, whether its status is withdrawn or a withdrawal holds it, as `withdrawn`;
  - on a rule version a later release replaced, naming the rule's release in force where there is one.
- It removes no row and changes no grant or role. Every hold stays as it was.

**The application code depends on this migration for the review queues.** Until it is applied, the
review queue in the Content area and the owner's queue in the System area answer "Apply the source
review migration before using the review queue." A withdrawal still goes through until then: its review
work stays open, and closes once the migration is applied.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the source watch stops migration (`valo_source_watches` has a
   `stopped_at` column), and that there is no `valo_source_review_notes` table.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125174829_source_review_owners.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_source_review_notes` is 0.
   - `SELECT count(*) FROM pg_trigger WHERE tgname = 'valo_guard_source_review_note'` is 1.
   - `SELECT pg_get_constraintdef(oid) LIKE '%withdrawn%' FROM pg_constraint WHERE conname =
     'valo_source_review_work_status_check'` is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any note is recorded and before any work closes as `withdrawn`: drop the trigger
`valo_guard_source_review_note`, the function `valo_guard_source_review_note()` and the table
`valo_source_review_notes`, and restore the status check without `withdrawn`. Once a note or a
withdrawn close exists, keep them: dropping them would lose what was checked and how the work closed.
