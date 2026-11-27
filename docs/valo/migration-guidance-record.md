# Applying the guidance record migration to the development database

`20261125153830_guidance_record` gives a regulatory article in the staff library its **record**: whom
and when it applies to, what a business does and keeps to show it, and its related templates
([the guidance record](../architecture/guidance-record.md), slice 1, CMP-001). It needs the library entry
details migration (`20261124232729_library_entry_details`) first, whose guard it replaces. It has not
been applied to the Replit development database yet.

- It adds three columns to `valo_manual_library`: `applies_to`, `action_evidence` and
  `related_templates`. Each is empty for every existing revision. Only a regulatory article may have
  them: whom it applies to and what to do and keep in up to 800 characters each, and up to six
  registered template numbers such as `TPL-16` (`valo_manual_guidance_record`).
- It replaces the library's guard, `valo_guard_manual_revision()`, with the same function plus two
  changes. The new columns join those a saved revision can never change. And a regulatory article is
  released only when it says whom it applies to, before the owner's sign-off and source check are
  checked as before.
- It changes no existing row, grant or role. A regulatory guide released before it stays released,
  without a record, and can still be withdrawn or replaced. A draft saved before it must be saved again
  with whom it applies to before the owner can sign it.

**The application code depends on this migration for the staff library and the owner's guidance
panel.** Until it is applied, the library's staff screens answer "Apply the editorial library migration
before using the publisher.", and the owner's guidance panel "Apply the latest editorial library
migrations before signing regulatory guides.", since they read the new columns. The site's public pages
do not read them yet, and show guides as before.

After it is applied, a Content editor can file the record each retained guide's draft gives with **File
the proposed records** under *Drafts ready to file*. Each guide then gets a new draft version, with its
text unchanged, for the owner to sign; filing releases nothing. The records come from the drafts'
editorial lines, which are written for staff: put them in customer words before the owner signs.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the library entry details migration (`valo_manual_library` has a
   `purpose` column), and that `valo_manual_library` has no `applies_to` column.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125153830_guidance_record.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_manual_library WHERE applies_to IS NOT NULL OR action_evidence IS NOT NULL
     OR related_templates IS NOT NULL` is 0.
   - `SELECT count(*) FROM pg_constraint WHERE conname = 'valo_manual_guidance_record'` is 1.
   - `SELECT pg_get_functiondef('valo_guard_manual_revision()'::regprocedure) LIKE '%OLD.related_templates%'`
     is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any record is saved: restore the guard from
`20261124232729_library_entry_details.sql`, then drop the constraint `valo_manual_guidance_record` and
the three columns. Once a revision carries a record, keep the columns: dropping them would lose what a
release said about whom its guide applies to.
