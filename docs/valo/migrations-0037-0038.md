# Applying migrations 0037 and 0038 to the development database

These come from PR 29 (source correction controls and the editorial lifecycle),
where they were numbered 0034 and 0035. Both are additive. Neither changes an
existing row. Neither has been applied to the Replit development database yet.

| Migration | Effect |
| --- | --- |
| `0037_source_correction_controls` | Eight new tables: source watches, daily check jobs, release bindings, source impacts, review work, dependency jobs, workspace correction notices and the safety control audit. Release bindings and the safety audit are append-only. Correction notices cannot be updated but can be erased. A source impact keeps its identity and cause; only its progress fields change. The bounded publisher role can read source state and bind evidence, but cannot clear a hold. |
| `0038_editorial_lifecycle_integrity` | Captured source snapshots become append-only: updates and deletes are refused. Adds the read-only `valo_content_reviewer_dev` role with `SELECT` on publication policies, content versions and source snapshots only. |

The Replit development database has no Drizzle ledger. Follow the existing
procedure in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at 0036 (the trigger
   `valo_staff_access_audit_append_only` exists) and that none of the new tables,
   the trigger `valo_source_snapshot_immutable` or the role
   `valo_content_reviewer_dev` exists. Roles belong to the whole PostgreSQL
   cluster, so check the role on the cluster, not only on this database. Record
   row and schema fingerprints.
2. Confirm nothing outside the tests updates or deletes rows in
   `valo_source_snapshots`. After 0038 those writes fail.
3. Pause writes and the worker. Take a fresh encrypted backup and privacy journal.
4. Apply each file on its own, in order, inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
5. Compare row fingerprints with step 1, restart the API and worker, and run the
   usual smoke checks.

Never run the full migrator against this database and never write ledger rows.
CI proves both migrations on clean, tracked and unjournalled databases, and
`lib/db/scripts/phase1-migrations.test.mjs` checks each upgrade from the
previous migration.
