# Phase 1: PR #23 with the PR #28 export changes

This is a development integration and migration runbook, not authorization to migrate a live environment or launch the product. PR #28's head `69d33dce438342ace568c1fabc637f7f0d1ecc12` is an ancestor of PR #23. Merge the combined PR #23 after its exact candidate passes CI; a separate #28 merge is unnecessary.

## Applied baseline and pending changes

The baseline is development commit `3a44b02834fa9b152c42209dc5971bc2c103d829`. Its 29 journal entries (indices 0–28) and SQL bytes are pinned in `phase1-migration-baseline.json`. The pre-existing filename gap at 0024 is intentional and is not repaired by renumbering applied history.

| Migration | Status | Effect |
| --- | --- | --- |
| Through `0029_privacy_copy_redaction` | Existing development history, unchanged | Existing export, dispute and privacy records |
| `0030_workspace_export_convergence` | Pending, index 29 | Export versions, worker generation, progress; preserves IDs, object keys and ready results |
| `0031_dispute_convergence` | Pending, index 30 | Dispute holds/lease, immutable inputs, concern threads, narrowly witnessed privacy redaction |

Only the two unapplied PR migrations were renumbered. Downstream PRs must rebase and reserve numbers starting at 0032; do not merge a competing 0031 file. No data backfill deletes customer content or financial history. New concerns and messages have separate tables; existing dispute records remain canonical.

## Verification performed

Run `VALO_RUN_MIGRATION_TESTS=synthetic-isolated-only pnpm --filter @workspace/db test:phase1-migrations` with PostgreSQL 16's `initdb` and `pg_ctl` on PATH (or `VALO_TEST_PG_BIN`). The test creates and destroys three independent localhost clusters and never consumes `DATABASE_URL` or `PGHOST`.

The five checks passed locally on PostgreSQL 16.14:

1. Every applied SQL SHA-256 and journal entry matches the pinned development baseline.
2. The complete 31-entry chain applies through the real Drizzle runner; a repeat changes neither schema nor migration ledger.
3. A tracked 29-entry database with existing exports, attempts, keys, orders and dispute intents upgrades without changing its pre-existing row fields.
4. Failure injected after the first pending migration rolls back schema and data completely.
5. An unjournalled 29-migration baseline upgrades using only the additive pair, preserves those same rows and matches the clean schema without inventing a ledger. Reapplication fails atomically.

Schema comparison covers columns/defaults, constraints, indexes, triggers, functions, table/column grants and editorial roles. Integration tests separately exercise workers, financial immutability, authenticated private-copy redaction and signed cleanup of actual download staging paths. These synthetic tests do not establish the current schema or backup restorability of a native or production database.

## Before applying to an existing environment

1. Pin the approved PR commit, retain both migration checksums and confirm the target environment explicitly. Keep API writes, export workers, refund/dispute dispatch and privacy processing paused throughout migration and smoke checks. Preserve current execution-disabled switches.
2. Take and validate a restorable database backup plus private-object inventory. Preserve authenticated deletion journals and their independent verification keys outside the backup; a restore must replay post-backup deletions before access opens. Record the recovery checkpoint without logging private payloads or credentials.
3. Inspect `to_regclass('drizzle.__drizzle_migrations')`, the actual applied ledger if present, and a schema-only inventory. Compare the target to the pinned 29-entry baseline, including triggers and privileges. Confirm existing export IDs/object keys, order amounts and dispute source hashes through scoped counts or fingerprints. Reject an unknown, partial or drifted baseline; do not infer equivalence from table names alone.
4. Confirm neither pending migration has already been manually applied. Export `version/queue_id/rows_processed/bytes_prepared/progress_section`, dispute `held/control_version/lease_until`, concern tables, or the new intent trigger indicate a different starting point. Investigate rather than skipping DDL or fabricating migration records.
5. Run the same additive pair against a disposable restored copy of the target and repeat the preservation and smoke checks before scheduling the actual upgrade. PostgreSQL roles are cluster-wide: a clean full-chain install needs an isolated cluster with no conflicting pre-existing `valo_content_*` roles; do not drop shared roles to make it pass.

## Select exactly one migration path

**Empty isolated database:** use `pnpm --filter @workspace/db exec drizzle-kit migrate --config ./drizzle.config.ts`. This is the clean-chain CI path.

**Tracked existing baseline:** only after verifying that its complete ledger and schema match the pinned baseline, run the same Drizzle command. The runner applies the two pending entries transactionally. Preserve the original ledger, including its real timestamps and hashes.

**Unjournalled native development baseline:** do not use the full Drizzle migrator. From the repository root, after the checks above, execute the two files in one transaction using the reviewed target connection:

```sh
PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f lib/db/drizzle/0030_workspace_export_convergence.sql \
  -f lib/db/drizzle/0031_dispute_convergence.sql
```

Keep the baseline explicitly unadopted. Record the actual target, commit, file hashes, operator, result and time outside customer logs. Do not add synthetic historical rows to `drizzle.__drizzle_migrations`. The older one-file export application helper is not the combined Phase 1 procedure.

Apply/verify the separately reviewed `valo_jobs` queue setup before enabling workers or privacy processing:

```sh
NODE_ENV=development VALO_DEV_QUEUE_MIGRATION=reviewed-synthetic-development \
pnpm --filter @workspace/api-server exec tsx src/scripts/queue-migration.ts apply-development
```

## Acceptance and recovery

Before resuming traffic, verify the resulting schema against the rehearsed candidate, unchanged historical IDs/keys/amounts/hashes, both queue names, and enabled immutability/redaction triggers. Using dedicated synthetic records, check one export through request → queued worker → ready → authorized download → cancel; verify foreign-tenant and revoked-session denial. Check a concern and prepared dispute while provider execution remains disabled. Run the privacy redaction/late-copy cleanup checks on synthetic records only. Record exact CI results and any skipped platform-specific proof; an old green run is not approval for a new head.

A migration error aborts the transaction; retain maintenance mode, confirm the baseline fingerprint and ledger are unchanged, correct the cause, then repeat the rehearsal. After a successful commit, prefer a forward correction with writes paused. Do not drop new columns/tables or remove the immutability trigger as an application rollback shortcut. If restoration is required, restore the validated pre-change backup into an isolated target, replay the authenticated deletion journal, reconcile objects and finance state, and revalidate before switching traffic. Reverting application code alone is not proof that the old privacy eraser can run against the new intent guard.

No native database was modified while preparing this PR. Native baseline inspection, restore rehearsal and the actual migration remain deployment steps. Passing this plan and CI makes the integration reviewable; it does not enable merchant calls, paid inference, external messages or production launch.
