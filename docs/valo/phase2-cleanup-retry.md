# Phase 2: workspace export cleanup retries

This change follows PR #32, merged into development at `3043279aba580359d1637901b6b317f6a4047743`. It addresses cleanup progress and visibility. Production storage, document-retention policy, external alert delivery and deployed disaster recovery remain separate launch gates. It does not enable production exports or enact any proposed legal/data-retention period.

## Failure and resulting behavior

Workspace cleanup selected five attempts by their historical cleanup-check time. Invalid object keys and privacy holds returned without advancing that time, so the same attempts could occupy every batch indefinitely. Storage failures also advanced the historical timestamp without recording why cleanup failed. The operations probe covered document-export orphans but omitted workspace JSON exports.

Migration `0033_workspace_cleanup_retry` adds `next_cleanup_at`, `cleanup_attempts`, a constrained `cleanup_error_code` and a due-time index. The worker commits a 60-second retry reservation for at most five attempts before taking any privacy locks or calling storage. Other workers skip locked reservations and honor their due times. A failed worker leaves a durable retry opportunity; the reservation is scheduling state, not deletion permission or a deletion receipt.

Every deletion still reacquires and authenticates privacy authority before locking the attempt, then rechecks its job, workspace and exact attempt-derived key. Invalid keys remain blocked and retry hourly. Privacy-held or privacy-owned attempts defer for a minute and retain their records. Storage failures use persisted exponential backoff from 30 seconds to one hour. Only successful storage and scratch cleanup advances `cleanup_checked_at`; success still schedules an hourly recheck for late accepted uploads. The native SDK cannot recall an already accepted storage operation; this change does not claim a new provider cancellation guarantee.

Cancellation, worker recovery and late-write cleanup requests make the affected attempts due again. No object key is rewritten, no ownership check is widened, no reservation is discarded, and the signed privacy erasure sequence is unchanged. Operational samples now include the workspace cleanup backlog, including blocked attempts during backoff, with a deduplicated local `WORKSPACE_CLEANUP_BACKLOG` alert. These local alerts are not external delivery to an operator.

## Development observations

After PR #32 merged, native development fast-forwarded onto a merge preserving its seven preview overrides. Its tree was identical to the previously validated candidate. API/frontend health, CSP, worker heartbeat, disabled execution flags, anonymous/forged staff denial, two startup tests and twelve standalone/embedded browser checks passed. No migration was required for PR #32.

A read-only storage audit on 2026-11-15 found ten older, noncanonical workspace export reservations. All ten requesters were synthetic, all ten exact referenced objects were absent, and eight workspaces already had privacy tombstones. No object contents were downloaded and no records or objects were deleted. This observation does not certify ongoing absence or authorize clearing signed privacy history. Retain these rows for reconciliation/replay; the retry fix prevents them from starving unrelated work.

## Migration procedure

The current Replit database has schema 0032 with an unadopted/empty Drizzle ledger. The new code must not run there before 0033 is applied. Do not run the full migrator or schema push against that ledger. Pending PRs #26/#29/#31 must rebase and reconcile their older migration numbers; this branch uses the next canonical number, 0033.

1. Pin the reviewed commit and SHA-256 of `lib/db/drizzle/0033_workspace_cleanup_retry.sql`. Verify the exact development target, baseline schema through 0032, existing privileges/triggers, zero ledger rows, and absence of all three new columns and the index. Reject drift or partial application.
2. Pause API writes and the export worker. Preserve all provider execution switches. Take a fresh private database checkpoint plus object inventory and independent authenticated deletion-journal checkpoint, following the existing recovery procedure. Restore the checkpoint into an isolated target first; do not export credentials or private backup contents into reports.
3. Record row counts and deterministic hashes of every existing column in `valo_workspace_export_attempts` and `valo_workspace_exports`. Rehearse 0033 on the restored target. Confirm identical existing IDs, keys, statuses, timestamps and privacy records, plus zero retry counters, null error codes and the due-time defaults. A prior cleanup timestamp schedules its next check one hour later; a missing timestamp schedules it at migration time. Historical check timestamps are not retroactive proof of deletion.
4. Apply only 0033 in one transaction with lock/statement bounds and stop on any SQL error. For the current unadopted target, use the reviewed one-file procedure:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/0033_workspace_cleanup_retry.sql
   ```

   A genuinely tracked database may use the normal runner only after every prior ledger entry matches the reviewed chain. Do not invent historical ledger rows. No queue migration is needed.
5. While writes remain paused, verify schema, old-column hashes, keys, counts and unchanged ledger. Start the reviewed API/worker build. Run health, access-denial, export creation/download and scoped synthetic cleanup checks. Confirm blocked reasons remain visible, unrelated valid work progresses, and privacy-held objects are not deleted. Record the final commit, SQL hash, checkpoint and receipts.

An error before commit must roll back all DDL and scheduling changes. After commit, prefer a forward fix or restore the prior application while leaving additive columns in place; the prior app remains security-equivalent for MFA because it includes PR #32, but its cleanup starvation bug returns. Do not drop reservation metadata as a rollback shortcut. Any database restore requires independent deletion-journal replay and object/access checks before reopening traffic.

## Verification

- `VALO_RUN_MIGRATION_TESTS=synthetic-isolated-only pnpm --filter @workspace/db test:phase1-migrations` creates fresh local clusters, pins all applied SQL through 0032, and exercises clean/rerun, tracked and unjournalled upgrades, injected transaction rollback, existing-record preservation and scoped SQL-checkpoint restoration. It never consumes a supplied database URL and does not substitute for a deployed full-backup recovery rehearsal.
- `NODE_ENV=development VALO_RUN_DB_TESTS=synthetic-development-only pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/valo-workspace-cleanup.integration.test.ts` exercises invalid-key batch starvation, authenticated holds, storage outage/backoff/recovery, late-upload recheck, concurrent reservation visibility, lock-timeout recovery and real SQL backlog probes. Its database must be disposable and local; storage is controlled.
- Existing export convergence, process-death, private release and portable erasure suites remain in CI. The operations tests prove local alert deduplication/recovery without external transports.

This PR's merge and native 0033 application are separate from the completed PR #32 merge. Production launch remains unapproved.
