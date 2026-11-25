# Applying the manual changes migration to the development database

`20261125132218_manual_changes` makes a staff-library version that follows an earlier release say what
changed ([keeping published guidance current](../architecture/guidance-currency.md), slice 3, CMP-005). It
needs the manual reviews migration (`20261125122001_manual_reviews`) first. It has not been applied to the
Replit development database yet.

- It adds one table, `valo_manual_changes`: what changed in a version, with a note of 20 to 1,000
  characters, who wrote it and when. Its trigger, `valo_guard_manual_change()`, accepts a note only for a
  draft that follows an earlier release of its entry, and refuses any change or removal.
- It adds a trigger to the library, `valo_require_manual_change()`, that releases a version which follows
  an earlier release only with its note, written in the same transaction. A first release needs none. This
  holds for every kind of entry, a regulatory guide signed by the owner included.
- It replaces `valo_note_library_edition()` so that the notice that a template's edition was replaced
  carries the new version's note, as a withdrawal's notice carries its reason. Its trigger stays as it was.
- It changes one check constraint, `valo_edition_notice_shape` on `valo_edition_notices`, so that a library
  notice of a replacement may carry a reason. A notice on the reviewed route carries one only for a
  withdrawal, as before. Every existing notice already meets the new constraint.
- It changes no existing row. Versions released before it keep no note, and their pages say nothing of
  what changed.

**The application code depends on this migration** for releasing a version that follows an earlier
release: the staff library and the owner's panel send the note, and until the migration is applied that
release fails. A first release works as before. The public pages read the notes only where the table
exists, and otherwise show none.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the manual reviews migration: the table `valo_manual_reviews` exists, and
   the table `valo_manual_changes` does not.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125132218_manual_changes.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM pg_trigger WHERE tgname IN ('valo_guard_manual_change', 'valo_require_manual_change')`
     is 2.
   - `SELECT count(*) FROM valo_manual_changes` is 0.
   - `SELECT pg_get_constraintdef(oid) LIKE '%route%library%' FROM pg_constraint WHERE conname = 'valo_edition_notice_shape'`
     is true.
   - `SELECT prosrc LIKE '%valo_manual_changes%' FROM pg_proc WHERE proname = 'valo_note_library_edition'`
     is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back:
1. Recreate `valo_note_library_edition()` from `20261125012048_edition_notices.sql`. Clear the reason of
   every library notice of a replacement (`UPDATE valo_edition_notices SET reason = NULL WHERE route =
   'library' AND kind = 'replaced'`), then drop `valo_edition_notice_shape` and add it again as that file
   defines it.
2. Drop the trigger `valo_require_manual_change` on `valo_manual_library` and its function.
3. Drop the trigger `valo_guard_manual_change`, its function and the table. The notes are lost with the
   table, and the notices already written keep the notes they carry.
