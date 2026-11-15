# Production infrastructure, external alerts and off-host recovery

## Current result and scope

PR #35 was merged into the development branch at `dec85e2218de2b7e107d13fc52ba0e69ff11248b`.
The native development merge is `0c989825ff9a138333cc1dc56ec2a06f2ce13249`, preserving
seven preview overrides. Native export/cleanup smoke and post-restart API, frontend,
staff-denial and worker checks passed. No database migration was needed.

This increment implements external worker/operations monitoring, an explicit notification
probe, and an encrypted recovery-archive upload/read-back command. It does not activate
production execution. The app remains unpublished, with no external provider credentials.
There is no evidence yet of a production worker, delivered external alerts or an
independent-host recovery. Existing local recovery evidence retains that scope.

## Proposed setup for owner approval

| Component | Concrete choice | Cost and decision |
| --- | --- | --- |
| App/worker hosting | Replit Reserved VM, same app, dedicated 1 vCPU / 4 GiB, one worker | Publishing UI quoted $35/month ($0.0486/hour) on 2026-11-15. This is a new hosting charge, separate from the approved GitHub Actions budget. |
| Initial deployment access | Invite only; separate empty production database; do not copy development data | Proposed settings only; the publishing form reset on tab change and nothing was saved. Production identity and queue/schema installation remain prerequisites. |
| Storage | Separate private production prefix in the existing app bucket | Production write/read/anonymous-denial/delete probe must run from the actual deployment. Current North America region is locked to the app bucket; confirm geography before provisioning. |
| Independent alerts | Healthchecks.io free Hobbyist account, separate worker and operations checks | Free plan currently includes 20 checks. Owner supplies a verified operations email and confirms receipt of failure and recovery notices. |
| Off-host archive | Private Backblaze B2 bucket in a separate account, restic over its S3 HTTPS endpoint | Published storage rate starts at $6.95/TB/month; approve a usage cap and region. Database, Replit storage/traffic and other services are additional. |
| Recovery keys | Independently held password manager entry plus a second recovery custodian | Preserve restic password and existing privacy/recovery signing keys independently of both Replit and the backup archive. |

The UI also offers shared 0.5 vCPU / 2 GiB at $15/month. The larger candidate gives
the API, Next.js and document-rendering worker more headroom; it is a starting choice,
not a measured capacity guarantee. Validate memory/CPU under representative load.
Do not publish just because the hosting form is complete: the current API production
command starts only the API, and runtime guards still reject production exports/workers.

Sources: [Replit machines](https://docs.replit.com/features/publishing/machine-configuration),
[private deployments](https://docs.replit.com/features/publishing/private-deployments),
[App Storage](https://docs.replit.com/features/data-and-storage/object-storage),
[Healthchecks pricing](https://healthchecks.io/pricing/),
[B2 pricing](https://www.backblaze.com/cloud-storage/pricing).

## External monitor provisioning and validation

Create two UUID-based checks named `Valo development worker` and `Valo development
operations` first. Use separate checks for production when its runtime is approved.
For both, select a one-minute period and two-minute grace, enable down/recovery email
notifications and verify the recipient. The integration sends no request body. Start the
checks only when the intended supervisor is running. Healthchecks must remain in a
separate failure domain from Replit.

Set these as server-side secrets; do not paste capabilities into chat, source, browser
frontend config, CI or published evidence:

| Variable | Value |
| --- | --- |
| `VALO_EXTERNAL_MONITORING` | `healthchecks` |
| `VALO_WORKER_MONITOR_URL` | Exact `https://hc-ping.com/<worker-check-uuid>` |
| `VALO_OPERATIONS_MONITOR_URL` | Exact `https://hc-ping.com/<different-check-uuid>` |

The built `worker:supervise` command sends only bodyless POST success/failure signals
every 30 seconds. It uses its own child's IPC messages, never another process's health
file or port. Worker readiness must be fresh; operations must additionally have a
successful sample no older than 120 seconds and no active internal alerts. A missing,
stopped, failed or stale child cannot renew success. Timeouts and provider errors yield
fixed log events without capabilities or provider details. HTTP redirects are refused.
Absent configuration makes no network calls; partial or invalid configuration stops
the supervisor before it starts a child. Existing `worker:dev` does not send these pings.

With a dedicated test check and approved recipient, explicitly trigger each state:

```sh
VALO_MONITORING_PROBE=synthetic-notification-only pnpm --filter @workspace/api-server valo:monitoring-probe worker failure
VALO_MONITORING_PROBE=synthetic-notification-only pnpm --filter @workspace/api-server valo:monitoring-probe worker success
```

Repeat with `operations`. Provider HTTP 200 proves acknowledgement, not notification
delivery. Record actual recipient receipt of both messages. Then stop the supervisor,
wait beyond period + grace and verify an independent missing-heartbeat alert. Restart
and verify recovery. On an isolated deployment with synthetic work, kill the child,
verify it is reaped before one replacement starts, and prove graceful drain. Keep
health port 8082 loopback-only; do not expose it through the Replit router.
Protocol: [Healthchecks ping API](https://healthchecks.io/docs/http_api/).

## Recovery archive contract and command

Use a private, consistent staging directory prepared under the existing validated
backup plan. Quiesce writers or use a reviewed consistency procedure for the database
and object inventory. This tool deliberately does not improvise that capture step.
Its `manifest.json` has this shape (all hashes and sizes must be actual file values):

```json
{
  "version": 1,
  "scope": "development",
  "releaseSha": "<exact 40-character lowercase release SHA>",
  "files": [
    {"path": "database.dump", "sha256": "<64-character SHA-256>", "bytes": 1},
    {"path": "recovery-controls.json", "sha256": "<64-character SHA-256>", "bytes": 1},
    {"path": "object-index.json", "sha256": "<64-character SHA-256>", "bytes": 1},
    {"path": "objects/<64-character object hash>.bin", "sha256": "<64-character SHA-256>", "bytes": 1}
  ]
}
```

The dump, private object bytes, complete logical-key index and authenticated controls
are confidential. Directories must be private, files owner-only, with no symlinks or
unlisted files. Never put `.env`, database credentials, restic password or signing keys
in this directory. Object-index semantics, snapshot consistency and control freshness
must be validated by the capture/replay process; byte checks do not establish them.

Provision the approved private B2 bucket, then use a bucket-restricted S3 application
key. Prefer restic's S3 backend, as its official documentation recommends for B2.
Supply `RESTIC_REPOSITORY` in this exact form:
`s3:https://s3.<region>.backblazeb2.com/<bucket>/valo-development` (or `valo-production`).
Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` privately on the dedicated runner.
Place the independently generated restic password in a private file outside the bundle
and set `RESTIC_PASSWORD_FILE`. Record recovery custody before uploading any data.
Initialize the repository once with the approved credential context using `restic init
--repository-version 2`; the archive command will never initialize it automatically.

```sh
VALO_RECOVERY_ARCHIVE_MODE=approved-b2 python3 scripts/ops/recovery_archive.py backup-and-verify /private/prepared-bundle /private/new-receipt.json
```

The command validates exact manifest membership and hashes, makes a verified tar,
backs it up through restic, restores the exact returned snapshot into a fresh private
directory with caching disabled, and checks every byte again. It accepts neither
arbitrary backend URLs nor inherited restic command overrides/application secrets.
Subprocess errors are redacted. A failed/partial backup or wrong password cannot
produce a success receipt. It never overwrites a receipt or deletes repository data.
Read-back uses the same runner, so even a successful B2 receipt explicitly retains
`independentHostRecoveryValidated: false`, `databaseRestoreValidated: false`,
`latestErasureReplayValidated: false` and `secretCustodyValidated: false`.

CI initializes only a disposable local repository with synthetic fixtures and an
independent password. It verifies a real restic round trip, wrong-password/missing-repo
failures, containment, privacy permissions and environment isolation. Local fixture
success always reports `offHostTransportVerified: false`.

## Completing off-host recovery and the production rollout

1. Approve provider accounts, region, budget and alert recipient. The owner completes
   account terms, credential creation and independent password custody privately.
2. Retain the latest authenticated erasure/revocation journal independently of older
   database/object snapshots. A journal shipped only inside an old snapshot cannot
   prevent resurrection after a later erasure. Do not mark backups operational until
   this separate current-journal capture, custody and freshness check is implemented.
3. Upload a consistent development recovery set to B2. On a separate clean runner,
   recover credentials from independent custody, download the exact snapshot, and
   restore into an isolated database and object namespace with all external effects
   disabled. Compare schema, table counts, constraints, private bytes and permissions.
4. Authenticate and replay the separately retained *latest* controls before any user
   access or workers. Repeat interrupted replay, stale key denial, physical deletion,
   tenant denial and queue recovery tests. Record actual RPO/RTO; transport read-back
   is not a substitute for these application assertions.
5. Agree backup cadence/retention after measuring volume. Initial proposal: hourly
   capture, daily retained recovery points for 30 days, monthly isolated restore.
   Add a separate Healthchecks backup check only after fresh consistent capture and
   current-journal persistence are part of the scheduled job. Emit success only after
   verified read-back; prove failure/missed-run alerts to the actual recipient.
   Retention expiry must be reviewed against privacy obligations and replay custody.
   No automated pruning or irreversible Object Lock policy is enabled by this PR.
6. Complete the production runtime activation change: API and supervised worker must
   share the approved root and separate database, all export/download/cleanup/privacy
   paths must use production adapters, and an outer manager must supervise both with
   at least 85 seconds of shutdown grace. Never set development flags in deployment
   to bypass runtime guards. Validate these paths on the invite-only deployment.
7. Only after deployed probes, restart/drain, notification delivery and independent
   recovery pass should customer release or production exports be enabled.

Restic references: [repository/password and B2 setup](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html),
[restore behavior](https://restic.readthedocs.io/en/stable/050_restore.html).
There is no SQL migration in this increment. Roll back its code by restoring the
previous build; unset monitoring configuration when returning to the prior supervisor.
Retain backup receipts, snapshots and independent keys through rollback.
