# Phase 2 first delivery: staff governance

PR #30 is the first Phase 2 dependency (IAM-002, SEC-006, part of SEC-008). It builds on development `994b1f6895e7eaf1df7b0a362c2bb7c487265d1f`, the merged PR #23 including #28. Migration 0032 adds audited role administration and database-enforced emergency expiry; it grants no real role. This runbook does not apply the migration, provision an administrator or authorize production launch.

## Migration contract

The development database already received 0030 and 0031 on 2026-11-15. Its schema was verified against all 31 SQL migrations, but its Drizzle ledger remains unadopted. Preserve that distinction. The Phase 1 files and ledger entries are unchanged; the new staff entry has index 31 and timestamp 1794705000003, greater than 0031's 1794705000002. Do not use the old branch's reserved 0034 file or timestamp. Pending migrations in #26, #29 and #31 must be reconciled after rebasing onto the merged sequence.

The change adds `expires_at`, `grant_mode`, `version` and `granted_at` to `valo_staff_assignments`, and creates `valo_staff_role_changes` with foreign keys, request deduplication, an index and an append-only trigger. Existing identity, role, active/revoked state, grantor, reason, creation time and access-audit rows remain unchanged. Existing assignments become permanent revision 1; the new `granted_at` defaults to the migration time and does not assert an unknown historical grant time. No role-change receipt is invented for those legacy rows.

Emergency expiry must be non-NULL and between 5 and 60 minutes after grant. Permanent grants cannot have an expiry. Both application checks and database constraints enforce this distinction. Expiry is checked against the database wall clock without depending on a worker sweep.

## Rehearsal and deployment procedure

1. Pin the reviewed PR head and compute the SHA-256 of `lib/db/drizzle/0032_staff_role_governance.sql`. Verify the actual target, schema, triggers, privileges and ledger against 0031. Reject a drifted, partially migrated or differently numbered target; do not use `IF NOT EXISTS` to hide it.
2. Pause API writes and workers, preserving the existing provider execution switches. Take a fresh database backup, private-object inventory and independent authenticated deletion-journal checkpoint. Restore the backup into an isolated target and verify existing permissions and object ownership before trying 0032.
3. Rehearse 0032 on that restored copy. Confirm unchanged assignment identities, active/revoked state and audit rows, zero new role-change receipts, the four new column defaults and the immutable audit trigger. Use synthetic identities to prove permanent-admin-only changes, fresh MFA, last-admin protection, expiry, exact retry, revoked-role denial and customer/foreign-tenant rejection.
4. For a genuinely tracked 31-entry database whose ledger matches the reviewed SQL, the normal Drizzle runner applies only 0032. For the current **unadopted development database**, apply only the new file in one transaction:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/0032_staff_role_governance.sql
   ```

   Do not run the full migrator against an empty/unadopted ledger and do not create fictional historical entries. This migration requires no queue change; preserve the Phase 1 queue schema and registrations.
5. With writes still paused, repeat schema and legacy-row fingerprints and the scoped synthetic smoke checks. Restore traffic only on the reviewed application version, with actual managed-session/MFA verification checked in the target environment. Record the commit, checksum, checkpoint, result and operator outside customer logs.

An error before commit must roll back all DDL and leave the baseline unchanged. After commit, prefer a forward fix while access is paused. Do not drop role history, disable its trigger or remove the expiry columns. **Do not roll back to Phase 1 application code while staff access is enabled:** that code does not enforce emergency expiry. Hold staff endpoints until expiry-aware code is restored, or use an independently reviewed recovery procedure that preserves audit evidence and denies those assignments. A database restore also requires deletion-journal replay and permission/object checks before reopening access.

## Automated evidence and remaining Phase 2 gates

`VALO_RUN_MIGRATION_TESTS=synthetic-isolated-only pnpm --filter @workspace/db test:phase1-migrations` now exercises the 32-entry chain. The retained script name is compatibility with Phase 1 tooling. It creates five independent local clusters; it never consumes a supplied `DATABASE_URL` or `PGHOST`. It pins all 31 applied SQL files, verifies contiguous indexes and increasing timestamps, exercises clean/rerun, tracked and unjournalled upgrades, injected rollback, existing staff/audit preservation, and NULL/out-of-range emergency-expiry rejection. The normal PostgreSQL and controlled browser CI jobs cover role mutations and interface boundaries.

This is the first Phase 2 implementation slice. The remaining safe-staging blockers are production-capable private storage/workers, enforced document retention, trusted proxy handling, CSP, external monitoring with a named responder, and deployed backup/recovery. Exit evidence must include a real managed-session create/save/export/download journey, revoked-session denial, worker restart recovery, retention cleanup and an alert reaching its operator. Controlled fixtures do not establish those deployed checks. #29 and #31 must adopt the common expiry/freshness boundary when their source/support/commercial endpoints are integrated; #2 remains the final promotion PR.
