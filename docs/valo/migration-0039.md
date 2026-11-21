# Applying migration 0039 to the development database

`0039_support_lifecycle` comes from PR 31 (support cases), where it was numbered
0033. It has not been applied to the Replit development database yet.

It is additive, but unlike 0037 and 0038 it writes rows:

- Five new tables: support cases, case messages, action requests, case events and
  content referrals. Their keys, foreign keys and checks use the names in the
  Drizzle snapshot.
- Action request records (customer and staff) and case events are append-only
  while their case exists.
- Every existing support ticket becomes an open case with the same identifier,
  except tickets in a workspace that has a privacy tombstone. Every existing
  account-access request becomes an open case too. No case is assigned, replied
  to or resolved by the migration, and the original tickets and requests are not
  changed.

The Replit development database has no Drizzle ledger. Follow the existing
procedure in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at 0038 (the role `valo_content_reviewer_dev` and the
   trigger `valo_source_snapshot_immutable` exist) and that none of the five new
   tables exists. Count support tickets outside tombstoned workspaces and
   account-access requests; after the migration the case count must equal their
   sum. Record row and schema fingerprints.
2. Pause writes and the worker. Take a fresh encrypted backup and privacy journal.
3. Apply the file on its own inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
4. Check the case count from step 1, compare the other row fingerprints, restart
   the API and worker, and run the usual smoke checks.

Never run the full migrator against this database and never write ledger rows.
`lib/db/scripts/phase1-migrations.test.mjs` checks the upgrade from 0038, on
tracked and unjournalled databases, including the backfill and the tombstone
exclusion.
