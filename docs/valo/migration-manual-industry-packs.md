# Applying the industry pack migration to the development database

`20261123165814_manual_industry_packs` lets the staff library hold an industry pack, the content
type of the six deeper industry packs in `docs/content-candidates/industry-content-candidates.md`.
It has not been applied to the Replit development database yet.

- It adds `industry_pack` to the kinds `valo_manual_library` accepts (`valo_manual_kind`).
- It requires an industry for a pack as for an introduction (`valo_manual_text`).
- It adds `valo_manual_one_pack`: an industry has at most one published pack at a time, as it has
  at most one published introduction.
- It reads and changes no existing row. Re-adding the two checks reads the table once to validate
  them; no existing row can fail them, since no row is a pack yet.

**The application code depends on this migration only for packs.** Until it is applied, saving a
draft of the new kind fails with `violates check constraint "valo_manual_kind"`; every other kind
works as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the hot-table index migration (`valo_events_workspace_created_idx`
   exists) and that `valo_manual_one_pack` does not exist.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261123165814_manual_industry_packs.sql
   ```

4. Check that
   `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'valo_manual_kind'` names
   `industry_pack`, and that `SELECT indexdef FROM pg_indexes WHERE indexname = 'valo_manual_one_pack'`
   returns one row.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back before any pack is saved, drop `valo_manual_one_pack` and re-create the two checks
as `20261122183800_manual_premium_templates` and `20261122124112_manual_library` define them.
