# Release, rollback, environments and alerts

Status: procedure only. No staging or production environment exists, and
nothing here authorises a deployment. Merging into `main`, deploying, opening
traffic and paying for hosting each need the owner approvals in `AGENTS.md`
section 1 (see decision 0005). The production preflight still reports
`launchReady: false` and lists `RETENTION_POLICY_AND_RELEASE_APPROVAL` among its
required evidence.

This page ties together procedures that already exist elsewhere:

- `docs/valo/phase1-migration-plan.md`: applying migrations one file at a time.
- `docs/valo/phase2-production-activation.md`: the private rehearsal and Reserved VM setup.
- `docs/valo/phase2-infrastructure-setup.md`: external monitors and the off-host archive.
- `docs/valo/phase2-scheduled-recovery.md`: backup cycles and host supervision.
- `docs/valo/operating-runbooks.md`: incident roles.

## Environment profiles

The code recognises three profiles. Every variable is registered, with its
purpose, in `artifacts/api-server/src/platform/settings.ts`. `.env.example` is
generated from that registry.

| Profile | How the code identifies it | What it allows |
| --- | --- | --- |
| Development | `NODE_ENV=development`, no `REPLIT_DEPLOYMENT` | Development-only features behind `assertDevelopmentRuntime`; test-mode payments and test email only when their switches are set. |
| CI and tests | `NODE_ENV=test` or `development` with synthetic `VALO_RUN_*` opt-ins | Synthetic records only; no real provider calls. |
| Private production rehearsal | `NODE_ENV=production` and `VALO_RUNTIME_ACTIVATION=private-rehearsal-v1` | Serves `GET /api/healthz` only. Start-up fails closed unless the configuration and the database identity check pass (below). |

The rehearsal refuses to start unless all of these hold
(`valo-runtime-activation.ts`, `valo-production-readiness.ts`):

- `VALO_WORKER_TOPOLOGY=replit-reserved-vm-same-app` and `VALO_WORKER_REPLICAS=1`.
- `VALO_RELEASE_SHA` is the 40-character commit being run.
- `VALO_PRODUCTION_DATABASE_ID` matches the database's `valo_runtime_identity` row.
- A separate production private storage directory is configured and passes its scope check.
- `VALO_WORKER_HEALTH_PORT` differs from `PORT` and `VALO_FRONTEND_PORT`.
- External monitoring is `healthchecks`, with separate worker and operations check URLs.
- `VALO_TRUSTED_PROXY_CIDRS` is set.
- Customer AI, sandbox checkout, refunds and disputes are each explicitly `false`.
- `SESSION_SECRET` has at least 32 characters and `VALO_ISOLATED_RECOVERY` is unset.

## What a release is

A release is one reviewed commit on `main`, named by its 40-character SHA.
Everything that runs is tied to that SHA.

- **Reserved VM path** (the current proposal): build in a clean checkout, then
  `python3 scripts/ops/release_manifest.py <root>` records hashes of the built
  server files, operations scripts and lockfile in `dist/release.json`.
  `scripts/ops/launch_rehearsal.py` refuses to start unless `VALO_RELEASE_SHA`
  matches and every pinned file is unchanged.
- **Container path** (prepared, not approved for production):
  `docker build --target api --build-arg VALO_RELEASE_SHA=<sha> -t valo-api:<sha> .`
  and the same with `--target web` and `valo-web:<sha>`. The SHA is stored as the image's
  `org.opencontainers.image.revision` label. Deploy by SHA or digest, never by
  `latest`. The preflight still requires the Replit same-app worker topology,
  so running production from containers first needs a reviewed change to that
  check. CI builds both images and proves that they start safely
  (`scripts/ops/check-container-images.sh`).

## Before a release

1. CI passes on the exact commit, including the container image job. A green
   local run is not CI.
2. Every new migration follows the compatibility rule below and has an upgrade
   check in `lib/db/scripts/phase1-migrations.test.mjs`.
3. A fresh backup and an independently verified privacy journal exist (a
   `backup_cycle.py` receipt with both read-backs). Record both snapshot IDs.
4. The release notes list requirement IDs touched, new or changed settings (the
   `.env.example` diff), new operator commands and the migrations.
5. The owner has approved the deployment.

## Schema compatibility rule: expand, then contract

Migrations only run forward; there are no down migrations. So that the previous
release can always run against the new schema, a release may only expand:

- add tables, nullable columns or columns with defaults, and indexes;
- add functions and triggers that do not reject writes the previous release makes.

Removing, renaming or changing the meaning of a column (contract) happens in a
later release, once a release that no longer uses the old shape is running. A
change that cannot follow this rule needs a written plan with a maintenance
window and a restore point, reviewed before merge.

## Deploying

1. Drain writes and the worker, as the migration plan describes.
2. Apply the release's migrations, one transaction per file with lock and
   statement timeouts.
3. Start the worker supervisor and the API from the same SHA.
4. Check: `GET /api/healthz`, `pnpm --filter @workspace/api-server valo:production-preflight`,
   worker readiness, and the external worker and operations checks.
5. Watch the alerts below until both external checks have reported success at
   least twice.

## Rolling back

| Situation | Action |
| --- | --- |
| Code fault, schema fine | Redeploy the previous SHA. The expand-only rule keeps the new schema compatible; new objects stay in place, unused. |
| Migration fails before commit | The transaction rolls back by itself. Keep writes drained, confirm the ledger and baseline are unchanged, fix the cause and rehearse again. |
| Migration committed but wrong | Fix forward with writes paused. Never drop new objects or remove an immutability trigger as a rollback shortcut. |
| Data damaged | Restore the pinned checkpoint into a new, isolated target, replay newer privacy controls (erasures) before any access, then switch. Never overwrite the live database. |

During any rollback keep older backups, the restic password and the signing keys
unchanged.

## Backup retention (proposed, needs owner approval)

Backups are never pruned today. Retention decides how long erased customer data
survives in backups, so it is an owner decision; the preflight lists it as
`RETENTION_POLICY_AND_RELEASE_APPROVAL`. The proposal:

- keep every snapshot from the last 48 hours;
- keep the newest snapshot of each UTC day for 35 days;
- remove anything older, so erased data leaves the backups within 35 days.

Database archives and privacy journals are planned separately, and the newest of
each is always kept. If a group's newest snapshot is older than 48 hours, backups
have stopped, and that group keeps everything until a backup succeeds again.

`scripts/ops/backup_retention.py` applies this policy to the output of
`restic snapshots --json` and prints what it would keep and remove. It needs no
credentials and deletes nothing. After approval, removal will be a separate
reviewed command with its own tests.

## Alerts

Each alert below already exists in code. Delivery depends on the external
checks, which are not provisioned yet.

| Alert | Raised when | Where |
| --- | --- | --- |
| Worker check missed | No success ping within 1 minute + 2 minutes grace, or the supervisor signals failure (stale readiness, stopped or failed child) | Healthchecks worker check, sent by `worker:supervise` |
| Operations check missed | No success within 1 minute + 2 minutes grace; success needs a sample under 120 seconds old and no internal alert | Healthchecks operations check |
| Backup check missed | No successful backup cycle within 1 hour + 15 minutes grace, or a cycle fails | Healthchecks backup check, sent by `backup_cycle.py` |
| `DATABASE_UNAVAILABLE` | The database probe fails | Internal operations sample |
| `WORKER_UNAVAILABLE` | Worker heartbeat missing, unhealthy or older than 90 seconds | Internal operations sample |
| `EXPORTS_BACKLOG` | More than 100 queued or running exports | Internal operations sample |
| `CLEANUP_BACKLOG` | Any export object overdue for cleanup | Internal operations sample |
| `EXPORT_RETENTION_BACKLOG` | Any ready export past its retention date | Internal operations sample |
| `WORKSPACE_CLEANUP_BACKLOG` | Any workspace export attempt overdue for cleanup or with a cleanup error | Internal operations sample |
| `PAYMENTS_BACKLOG` | Any verified payment without its entitlement or receipt | Internal operations sample |
| `<NAME>_PROBE_UNAVAILABLE` | A probe query fails or times out (2 seconds) | Internal operations sample |

Internal alerts are recorded with active and resolved events. Any active
internal alert stops the operations check from reporting success, so it reaches
the operator through the external check.

Errors are logged as structured events without messages or customer data
(`safe-error.ts`). An external error tracker would be a new dependency and a new
processor of operational data, so it needs owner approval.
