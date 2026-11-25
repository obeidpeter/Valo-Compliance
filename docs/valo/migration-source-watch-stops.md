# Applying the source watch stops migration to the development database

`20261125171850_source_watch_stops` stops the daily check of a source the source register retires, and
restarts it when the source is brought back ([the source register](../architecture/source-register.md),
slice 2, ADM-003 and CMP-007). It needs the source register migration
(`20261125164717_source_register`) first. It has not been applied to the Replit development database
yet.

- It adds one column to `valo_source_watches`: `stopped_at`, when the daily check stopped because the
  register retired the source. It is empty while the source is watched.
- It adds the trigger `valo_source_register_watch` on `valo_source_register`, after each new version.
  A retired version stops its source's watch. An active version that follows a retired one restarts
  it, due at once. A source nobody watches has no watch to stop.
- It stops the watch of any source whose latest register version is already retired when it is
  applied. Nothing else changes: no row is removed, and no grant or role changes.

**The application code depends on this migration for the daily check and the source controls.** The
daily check's scheduler, the source gate, the release bindings, the current captures a guide or rule
is prepared from, the source controls and the register read `stopped_at`. Until the migration is
applied, they fail with `column "stopped_at" does not exist`.

After it is applied, retiring a source in the register stops its daily check and holds every version
that rests on it, until a new version of each passes the gates. Bringing the source back restarts the
check, and what was held stays held.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the source register migration (there is a `valo_source_register` table),
   and that `valo_source_watches` has no `stopped_at` column.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125171850_source_watch_stops.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM information_schema.columns WHERE table_name = 'valo_source_watches' AND
     column_name = 'stopped_at'` is 1.
   - `SELECT count(*) FROM pg_trigger WHERE tgname = 'valo_source_register_watch'` is 1.
   - `SELECT count(*) FROM valo_source_watches w WHERE w.stopped_at IS NULL AND (SELECT r.status FROM
     valo_source_register r WHERE r.source_id = w.source_id ORDER BY r.version DESC LIMIT 1) =
     'retired'` is 0.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any source is retired: drop the trigger `valo_source_register_watch` on
`valo_source_register`, the function `valo_source_register_watch()`, and the column
`valo_source_watches.stopped_at`. Once a watch has stopped, keep them: dropping them would restart the
daily check of a retired source.
