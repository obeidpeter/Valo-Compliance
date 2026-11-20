# Applying the prepared candidates migration to the development database

`20261120002839_prepared_candidates` records each template candidate prepared for its two reviews
(decision 0014), so the staff Content area can list it; this resolves the former known issue
KI-010. It has not been applied to the Replit development database yet.

- It creates `valo_prepared_candidates`. Each row holds:
  - the candidate's private artifact (ID and SHA-256);
  - the version ID and number the candidate will be saved under;
  - its template and candidate hash;
  - when it was prepared, and the date it must be reviewed by.

  Hashes must be 64 hex characters, the version positive, and each version ID appears once.
- It grants `valo_content_drafter_dev` only `SELECT` and `INSERT` on it; the preparer adds rows as
  that role. The publisher role and customer requests acting as `valo_workspace_scope` get
  nothing.
- It reads and writes no existing row.

**The application code depends on this migration.** After this change, preparing a template
candidate adds its record, and the staff Content area reads the table. Apply the migration before
this code runs against the development database. Until then the preparer and the Content area
both fail with `relation "valo_prepared_candidates" does not exist`.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the price change log migration (`valo_price_changes` exists) and
   that `valo_prepared_candidates` does not exist.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261120002839_prepared_candidates.sql
   ```

4. Check that
   `SELECT has_table_privilege('valo_content_drafter_dev', 'valo_prepared_candidates', 'INSERT')`
   returns `true`. Check that the same query with `'UPDATE'`, and
   `SELECT has_table_privilege('valo_workspace_scope', 'valo_prepared_candidates', 'SELECT')`,
   return `false`.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

Candidates prepared before the migration have no record; prepare them again to list them.
