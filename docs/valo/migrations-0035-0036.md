# Applying migrations 0035 and 0036 to the development database

Both migrations are additive and change no existing rows.

| Migration | Effect |
| --- | --- |
| `0035_saved_templates` | New `valo_saved_templates` table (PR 26: saved catalogue items). |
| `0036_audit_append_only` | Staff access audit becomes append-only: updates and deletes of real staff rows are refused (synthetic `synthetic-*`/`privacy-fixture-*` rows can still be removed by tests). `TRUNCATE` is refused on the staff audit and role-change tables. |

The Replit development database has no Drizzle ledger. Follow the existing
procedure in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at 0034 (the `valo_runtime_identity` table exists) and
   that neither `valo_saved_templates` nor the trigger
   `valo_staff_access_audit_append_only` exists. Record row and schema fingerprints.
2. Pause writes and the worker. Take a fresh encrypted backup and privacy journal.
3. Apply each file on its own, in order, inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
4. Compare row fingerprints with step 1, restart the API and worker, and run the
   usual smoke checks.

Never run the full migrator against this database and never write ledger rows.
CI proves both migrations on clean, tracked and unjournalled databases.
