# Production rehearsal and changed-erasure replay

This checkpoint permits a private infrastructure rehearsal. It does not permit a
customer launch. PR #37 is merged into development (`95f15e5`); its native merge,
five export/cleanup smoke groups, API/worker readiness, denied staff access and a
scheduled encrypted backup cycle passed without changing existing rows.

## Runtime contract

`VALO_RUNTIME_ACTIVATION=private-rehearsal-v1` is necessary but insufficient.
Each API, supervisor and worker process reads the database before starting. The
single `valo_runtime_identity` row must match the configured instance UUID,
`production-rehearsal` environment and production storage fingerprint. Development
copies retain their development marker and fail. The worker rechecks that binding
and fixture-only content during dispatch. Queues must match the reviewed retry and
lease settings. A missing marker or any unexpected customer, order or deletion
case closes readiness. There is no automatic migration or promotion at startup.

The real export worker uses `valo/production/...` object keys under a separate
private storage root. Development roots and object keys cannot be used. Payment,
AI and operational delivery execution remain disabled. Every production HTTP
route, including authentication and webhooks, returns 503 before application
effects; only `GET /api/healthz` is available. This is an infrastructure rehearsal,
not a partially opened customer application. Production erasure and public release
still require their own review and evidence.

## Migration 0034

`0034_runtime_identity.sql` SHA-256:
`8b6b49c37f6e7ccdb0b868b22818a545fb1522cd7474a84c6133ad78ffc77ab9`.

The migration creates one table and one randomly identified development row. It
changes no existing rows, grants or jobs. Native development has **not** received
0034. The native ledger remains unjournalled; do not run the full migrator there.

For an authorized development rollout:

1. Confirm the expected native database identity and schema through 0033; require
   the new table to be absent. Record row/schema fingerprints and the unchanged
   Drizzle ledger. Drain writes and the worker.
2. Create and verify a fresh encrypted DB/files checkpoint and independently signed
   privacy journal. Pin both snapshot IDs, hashes, source identity and cutoff.
   Historical rehearsal evidence is not a replacement for this fresh checkpoint.
3. Execute **only 0034** in one transaction with a five-second lock timeout and
   sixty-second statement timeout. Before commit, require exactly one marker with
   `environment=development`, a UUID and null storage fingerprint; compare all
   previous rows/schema/grants and the ledger to the preflight baseline.
4. Commit, rebuild/restart the pinned development release, then check API, worker,
   denied staff access, native export/cleanup and scheduled backup readiness.

Before commit, rollback removes the entire change. After commit, reverting the
application code can leave this inert additive table in place. A full data rollback
requires restoring the pinned checkpoint into a new isolated target and replaying
newer privacy controls before any access is restored. Do not drop or overwrite a
live database as an implicit rollback.

CI exercises tracked and unjournalled upgrades from 0033, interrupted transaction
rollback, unchanged existing rows, default development identity and constraints.
Earlier applied migrations remain byte-pinned.

## Reserved VM setup

Use a **new clean Replit app from the reviewed Git commit**. Never publish the
development workspace: it contains native preview overrides, private recovery
artifacts and development credentials. Replit publishes a workspace snapshot;
Git ignore rules are not a proven deployment exclusion mechanism.

The reviewed hosting proposal is Reserved VM, dedicated 1 vCPU / 4 GiB, $35/month
compute ($0.0486/hour), invite-only, North America, with development data copying
disabled. No production app or resources have been provisioned. Provider provisioning, recurring charges and
new production credentials require owner approval. Database/storage usage must
stay within separately approved limits; this compute quote is not a total bill.

Use the existing frozen dependency installation and API build, then run
`python3 scripts/ops/release_manifest.py .` in the clean checkout. The manifest pins
the compiled API/worker/supervisor/operator files, host scripts, reviewed queue SQL
and lockfile. A changed, missing or extra executable fails startup. Runtime does
not require a `.git` directory. Build the external native dependencies and Chromium
needed by document rendering before attempting export canaries.

Provision an empty, separate production DB; apply the reviewed full migration
chain there. Read its new instance UUID. Configure deployment secrets with:

- `NODE_ENV=production`, `VALO_RUNTIME_ACTIVATION=private-rehearsal-v1`;
- `VALO_RELEASE_SHA` equal to the manifest commit;
- `VALO_PRODUCTION_DATABASE_ID`, independent `DATABASE_URL` and a fresh `SESSION_SECRET` of at least 32 characters;
- `PRIVATE_OBJECT_DIR` for exclusion checking and a non-overlapping
  `VALO_PRODUCTION_PRIVATE_OBJECT_DIR`;
- `VALO_WORKER_TOPOLOGY=replit-reserved-vm-same-app`, `VALO_WORKER_REPLICAS=1`;
- public API `PORT` and a distinct internal `VALO_WORKER_HEALTH_PORT`;
- separate production worker/operations Healthchecks capabilities;
- `VALO_CUSTOMER_AI_ENABLED`, `VALO_SANDBOX_CHECKOUT_ENABLED`,
  `VALO_SANDBOX_REFUNDS_ENABLED` and `VALO_SANDBOX_DISPUTES_ENABLED` explicitly `false`.

Do not copy B2, restic, model, payment or development authentication credentials
into the deployment. Production monitoring must not reuse development check URLs.

On the approved empty database, run the built `production-bootstrap.mjs
--assign-empty-rehearsal` with the explicit
`VALO_EMPTY_DATABASE_BOOTSTRAP=approved-empty-rehearsal` opt-in. It locks the empty
business tables, verifies the new database identity, installs the pinned queue SQL
only when absent, creates the two reviewed queues, verifies their configuration
and assigns the production storage binding **in one transaction**. Existing queue
schemas are checked, never silently repaired. Remove the bootstrap opt-in afterward.

Run `python3 scripts/ops/launch_rehearsal.py` as the Reserved VM command. It runs
the full database-bound rehearsal preflight and supervises API and worker groups
with bounded restarts and graceful shutdown. The worker health port stays internal.
Require provider restart, real private storage/export canaries, external DOWN/UP
delivery, deployment restart, off-host backup schedule and recovery evidence
before considering public release. Replit's actual termination budget remains a
deployed validation item.

## Separate-host changed-erasure proof

An isolated PostgreSQL source on Replit creates three synthetic tenants and files,
captures a pre-erasure snapshot, then performs a verified application erasure and
membership revocation. A separately retained signed receipt accompanies the old
snapshot. The encrypted handoff was copied through the approved development B2
repository and hash-verified on the owner's Windows machine.

The Windows target is restricted to a fresh named directory, the exact
`valo_restore_target` database, owner, loopback address and port, with synthetic-only
workspaces and no provider credentials. Tests reject wrong keys, changed inner
receipts and cross-tenant controls without committed effects; import is idempotent.
Erased and revoked accounts remain denied while the unaffected tenant stays usable.
Physical deletion is tested through a provider failure, process exit immediately
after file removal, resumed replay and repeated replay. The cluster is then stopped
and disposable plaintext removed. This proves synthetic application erasure across
hosts; it does not claim production or external-provider erasure fulfillment.

The rehearsal exposed timezone-dependent JSON signatures. Application sessions,
receipt capture and receipt import now use UTC, retaining the signed proof checks.
Source receipts created under an unsupported historical timezone must remain held
for review rather than being silently rewritten or resigned.
