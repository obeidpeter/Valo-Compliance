# Applying the constraint names migration to the development database

`20261117112017_constraint_names` renames 46 primary keys, unique constraints and
foreign keys that migrations 0007 to 0032 let PostgreSQL name, to the names in the
Drizzle snapshot. drizzle-kit writes every later migration from the snapshot, so
before this a generated migration that dropped or changed one of these keys would
have failed against every real database. It has not been applied to the Replit
development database yet.

- Only names change. No key is added, dropped or checked again, and no row is
  read or written. Renaming a unique constraint or primary key renames its index
  too.
- No application code refers to these names. Database errors that quote a key
  now show its new name.
- Each rename takes a brief exclusive lock on its table, so apply it while writes
  are paused.
- Names longer than 63 bytes are written in full, as Drizzle generates them.
  PostgreSQL keeps the first 63 bytes and prints a notice for each.

The same change makes the Drizzle schema describe keys, checks and indexes the
database already had: the bindings that tie dispute information, dispute actions
and payment-concern messages to one dispute or concern of the same order, nine
indexes, 83 check constraints, and unique constraints the schema had described
as unique indexes. The schema no longer declares four payment-concern foreign
keys that no migration created. None of this changes the database.

`0035_saved_templates` and `0037_source_correction_controls` now name their keys
as the snapshot does. Neither had been applied to the development database, and
their procedures require their tables not to exist before applying, so no
database has their earlier names.

The Replit development database has no Drizzle ledger. Follow the existing
procedure in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at 0039 (the table `valo_support_cases` exists) and
   that the constraint `valo_orders_workspace_id_fkey` exists. Record the number
   of constraints and indexes in the `public` schema.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
4. Check that `valo_orders_workspace_id_fkey` no longer exists,
   `valo_orders_workspace_id_valo_workspaces_id_fk` does, and the counts from
   step 1 are unchanged. Restart the API and worker and run the usual smoke
   checks.

To undo it, rename each key back by swapping the two names on each line.

Never run the full migrator against this database and never write ledger rows.
`lib/db/scripts/phase1-migrations.test.mjs` checks the upgrade from 0039 on
tracked and unjournalled databases: rows and every key and index definition stay
the same apart from names. It also compares every key and index of a freshly
migrated database with the latest snapshot, using
`lib/db/scripts/snapshot-parity.mjs`.
