# Export retention across an older restore

An older database can contain a null or later export deadline even after the
source has assigned a retention date, expired an export or regenerated its bytes.
Previously the independent recovery journal contained privacy controls only.
Restoring that database therefore did not preserve later retention decisions.

## Current behavior

Development journal capture now includes a complete, bounded DOCX/PDF asset
inventory in the same read-only transaction as privacy controls. Each entry binds
the database, workspace, asset, job generation, object key, checksum, size,
creation time and exact deadline. The existing MAC authenticates it; the encrypted
off-host copy remains independent of the database snapshot. Capture fails rather
than signing a partial inventory.

Scheduled backup success requires this inventory in both capture and readback.
Old journals retain their original privacy evidence but cannot satisfy retention
replay. Archive transport does not claim signature verification or replay on a
recovery host. Release manifests also pin the JavaScript operations helpers.

`scripts/ops/retention_restore.mjs` provides an offline, **synthetic-only** replay.
It requires a fresh local cluster, the `valo_retention_restore` database,
`valo_retention_test` owner, exact local port/data directory and synthetic
workspaces. It cannot target managed development or production. It does not start
an application, call storage, send messages or authorize physical cleanup.

Replay authenticates the independent key, source/database identities, snapshot
cutoff and freshness. It locks the relevant tables and requires all privacy rows
to match the current journal. Changed holds, revocations, erasure records or an
incomplete control set stop the entire transaction. Reconcile privacy through the
established recovery procedure first; changing a raw status to “released” cannot
bypass this check. Journal freshness is checked again before commit.

- Matching generations receive the exact current deadline. Earlier restored
  deadlines are never extended.
- Missing, replaced, unreadable or unassigned generations are quarantined by
  failing their ready jobs. Existing failed-job diagnostics are preserved.
- Quarantine keeps bytes, assets, cleanup reservations and saved revisions. It
  never reopens a failed job. Investigate before enabling access or cleanup.
- Every changed deadline or newly quarantined job gets an audit event bound to
  the journal hash. Original audit, financial and privacy records are preserved.
  Concurrent or repeated replay makes no duplicate changes.

The `rehearse` command executes and rolls back; explicit `apply` commits. An audit
failure rolls back all writes. Operator inputs and output must be private files
inside the exact disposable root. Neither command enables application access.

## Validation

Run `node --test scripts/ops/recovery_contract.test.mjs scripts/ops/export_retention_contract.test.mjs`
and `python3 scripts/ops/retention_recovery_drill.py` with installed PostgreSQL
tools, Node and frozen repository dependencies. CI retains the drill report.
The drill creates, migrates, dumps and restores its own local cluster; no managed
database, storage, payment or model credentials are inherited.

The real dump predates later deadline assignments and a removed generation.
Tests reproduce the gap, then exercise MAC/source/target rejection, privacy drift,
rollback, audit failure, concurrent replay and retries. Actual application
download guards deny expired and quarantined exports. An authenticated hold,
fixture bytes, saved revisions and a financial event are preserved. Successful
runs remove the cluster and disposable data. This is local synthetic proof, not
a new independent-host or production restore acceptance.

## Development rollout and rollback

No migration or backfill is introduced. After review/merge, use the existing
backup/drain/build/smoke sequence and deploy the complete operations helper set
together. Verify a scheduled receipt has `retentionInventoryPresent: true`, then
authenticate a fresh journal and inspect its inventory in an isolated exercise.
Preserve the already approved 36 development deadlines; do not reapply them.

For rollback, drain the scheduler and let capture finish, then restore the previous
complete helper set and its pinned runtime. Keep snapshots, journals, deadlines,
audit history and keys. Older code does not produce retention-aware journals and
cannot supply this new proof. Never open a restored app with a stale/legacy journal
or treat code rollback as permission to revive exports or older privacy state.

Production infrastructure remains uncreated. Production backup policy, fresh
independent-host retention replay, deployed provider/worker validation and release
approval remain required. This change does not approve pruning or alter financial,
privacy or backup retention policy.
