# Applying the source register migration to the development database

`20261125164717_source_register` adds the **source register**: the official sources Valo reads, as staff
keep them, each a series of versions that are never changed or removed
([the source register](../architecture/source-register.md), slice 1, ADM-003). It follows the guidance
record migration (`20261125153830_guidance_record`) in the journal, and reads only the staff assignments
table, which the staff migration made. It has not been applied to the Replit development database yet.

- It creates one table, `valo_source_register`. Each row is one version of one source's entry: its
  title and address, who issues it, where it applies, the kind of text, the version in force, the day
  that version took effect, whether the source is active or retired, why the version was recorded, who
  recorded it and when. A source's versions are numbered from 1 (`valo_source_register_version`). Each
  field stays within its limits: an `https://` address, a known kind of text and status, no day for an
  official page, and why in 20 to 1,000 characters (`valo_source_register_fields`).
- It adds the guard `valo_guard_source_register()`. A version is recorded only by an active Content
  editor, only as the next version of its entry, and only at the address the entry was first recorded
  at. The database dates each version itself. No version is ever changed or removed: a correction, a
  retirement and a return are each a new version with why.
- It changes no existing row, grant or role. The table has no workspace rows, and customer requests are
  given nothing on it. The daily check and the source fetcher do not read it yet: they still read only
  the addresses in code.

**The application code depends on this migration for one staff screen.** Until it is applied, the
register in the staff Content area answers "Apply the source register migration before using the
register." Nothing else reads the table, so the rest of the site works as before.

After it is applied, a Content editor files the regulatory sources kept in the repository with **File the
28 sources kept in the repository** under *Official sources*. Each gets its first version, with who
issues it, the kind of text and the day it took effect where the repository's claim maps and amendment
records say so, and Nigeria as where it applies. Filing fetches nothing and publishes nothing. Complete
what each entry does not say yet with **Correct this entry**, saying why.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the guidance record migration (`valo_manual_library` has an `applies_to`
   column), and that there is no `valo_source_register` table.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125164717_source_register.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_source_register` is 0.
   - `SELECT count(*) FROM pg_constraint WHERE conname IN ('valo_source_register_version',
     'valo_source_register_fields')` is 2.
   - `SELECT count(*) FROM pg_trigger WHERE tgname = 'valo_guard_source_register'` is 1.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any source is filed: drop the table `valo_source_register`, which drops its
trigger, then the function `valo_guard_source_register()`. Once an entry is filed, keep the table:
dropping it would lose the staff's corrections and why each was made.
