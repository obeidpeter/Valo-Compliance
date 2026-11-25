# Applying the library escalations migration to the development database

`20261125145208_library_escalations` lets a support request's referral point at a staff-library entry
([holding, withdrawing and reporting staff-library entries](../architecture/library-holds.md), slice 3,
ADM-008). It needs the manual holds migration (`20261125140207_manual_holds`) first. It has not been
applied to the Replit development database yet.

- `valo_support_escalations.target_kind` now also takes `library`: the referral points at one edition of
  the staff library, with its digest and version.
- A new column, `library_hold_id`, keeps the staff-library hold that "Hold version and queue reassessment"
  placed, or found already placed, for a library referral. Its foreign key is
  `valo_support_escalation_library_hold_fk`, to `valo_manual_holds`.
- The check `valo_support_escalation_hold_kind` keeps a library hold to a library referral, and a source
  impact to a referral of a reviewed version or a rule release.
- Its trigger, `valo_guard_escalation_library_hold()`, keeps the exact version every referral points at.
  A library referral's hold is set once, and only to a hold placed on that edition. A privacy erasure can
  still replace a referral's reason, as before.
- It changes no existing row. Every referral made before it keeps its reviewed version or rule release,
  with no library hold.

**The application code depends on this migration** for library referrals only. Until it is applied, a
referral to a library entry is refused by the database's check, and nothing else changes.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the manual holds migration: the table `valo_manual_holds` exists, and
   `valo_support_escalations` has no column `library_hold_id`.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125145208_library_escalations.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM pg_constraint WHERE conname IN ('valo_support_escalation_library_hold_fk',
     'valo_support_escalation_hold_kind', 'valo_support_escalations_target_kind_check')` is 3.
   - `SELECT count(*) FROM pg_trigger WHERE tgname = 'valo_guard_escalation_library_hold'` is 1.
   - `SELECT count(*) FROM valo_support_escalations WHERE library_hold_id IS NOT NULL` is 0.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_support_escalations', 'SELECT')` is still
     true, and `has_table_privilege('valo_workspace_scope', 'valo_support_escalations', 'UPDATE')` is still
     false.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back:
1. Keep a copy of the library referrals outside customer logs, then delete them: the old check refuses
   them.
2. Drop the trigger `valo_guard_escalation_library_hold` and its function.
3. Drop the constraints `valo_support_escalation_hold_kind` and `valo_support_escalation_library_hold_fk`,
   then the column `library_hold_id`. The holds those referrals placed stay in the staff library.
4. Replace `valo_support_escalations_target_kind_check` with `target_kind IN ('content','rule')`.
