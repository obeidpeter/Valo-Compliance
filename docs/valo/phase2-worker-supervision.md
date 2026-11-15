# Phase 2: bounded worker supervision and recovery evidence

An unresponsive worker can stay alive while exports stop progressing. The candidate
supervisor monitors successful dispatch reports, restarts a failed child with
backoff, and refuses to replace it until that child has exited. It does not activate
production processing or change existing Replit workflows.

## Runtime contract

Build the API package, then run `pnpm --filter @workspace/api-server worker:supervise`
in an explicitly non-deployed development environment. The shipped
`dist/export-supervisor.mjs` launches only its sibling `export-worker.mjs` through
Node, without a shell or a configurable command string. It inherits server-side
configuration. Production and deployment markers are rejected before spawning.

The worker sends its existing v2 health snapshot over its own IPC channel only
after persisting the heartbeat. The supervisor cannot mistake a different process
listening on the same health port for its child. The HTTP health endpoint remains
loopback-only and contains no identifiers. A missing parent IPC channel causes a
supervised worker to drain.

| Condition | Response |
| --- | --- |
| No successful dispatch within 120 seconds of startup | Begin drain and restart |
| Failed readiness for 30 seconds since the last healthy report | Begin drain and restart |
| Missing/stale success reports | Apply the existing 90-second freshness check; restart within 120 seconds of the last healthy report |
| Unexpected exit or spawn failure | Retry with exponential backoff from 1 second, capped at 30 seconds |
| Five restarts within ten minutes | Stop with exit 1 and an exhaustion event |
| SIGTERM/SIGINT | Stop restarting, forward SIGTERM, wait for child exit |
| Child still running after 75 seconds of drain | Send SIGKILL; wait up to 5 more seconds |
| Termination remains unconfirmed | Exit 1 without spawning a replacement |
| Child fails or is force-killed during shutdown | Exit 1; never report a clean drain |

The outer process manager must allow **more than 80 seconds** for shutdown (use at
least 85 seconds), maintain exactly one supervisor, restart a failed supervisor,
and deliver exhaustion/stall alerts externally. This code guarantees one child
per supervisor; it does not prevent an operator from starting multiple supervisors.
An external monitor is still necessary if the supervisor or entire host freezes.
Structured stdout events contain fixed event/reason codes and attempt counts only.
They do not constitute delivered alerts.

## Validation

The readiness suite exercises real child processes: crash/replacement, live but
unhealthy children, hung startup, signal deadlines, restart exhaustion, interrupted
backoff, and unconfirmed termination. POSIX CI proves graceful signal handling;
Windows cannot prove SIGTERM behavior. The disposable PostgreSQL test starts the
actual worker, detects queue drift, recovers, proves a supervised crash and
replacement, and verifies that loss of IPC drains the worker. The built-artifact
test verifies the shipped supervisor refuses production before spawning.

Following PR #34's merge, the authorized development rehearsal established:

- The API and managed development worker restarted successfully; private export,
  range-download, tenant/session denial, cleanup retry and privacy-hold smoke checks
  passed without changing pre-existing rows or retaining test objects.
- A fresh read-only development database backup restored into an isolated,
  socket-only PostgreSQL cluster. All 70 tables matched snapshot row fingerprints,
  schema and privileges; restored cleanup smoke tests passed. No SQL migration or
  migration-ledger adoption was performed.
- The candidate production namespace in the existing private bucket passed a real
  provider canary from the development workspace: checksum round trip, anonymous
  denial, deletion and a later cleanup recheck. Its locator and recovery evidence
  remain private in Replit. This does not prove deployed production credentials.
- The independent synthetic recovery exercise passed signed erasure/revocation
  replay, tamper rejection and recovery after interruption. It uses disposable
  objects and is not an off-host or production storage restore.

These observations are point-in-time development evidence. Neither a namespace
canary nor the new supervisor is production release approval.

## Remaining deployment work

1. Review and provision the same-app Reserved VM candidate with one supervised
   worker and a separately initialized production database. The inspected publishing
   setup is unpublished, defaults to Autoscale/Public, and proposes copying
   development data. Do not use those defaults for the private candidate.
2. Install production configuration and credentials privately, pin the release,
   validate queue/schema installation, and rerun the canary from the deployment.
   The workspace-derived candidate prefix is not automatically deployment config.
3. Complete the production runtime activation change across export creation,
   download, cleanup, privacy erasure and operations. Existing guards remain closed.
4. Prove deployed crash/restart and in-flight drain, external alert delivery, and an
   off-host restore with authenticated deletion-journal replay and independent key
   custody. Agree backup retention and geography before release approval.

No SQL migration accompanies this increment. Rollback restores the previous
application build and normal worker command. It never deletes customer objects,
changes queue settings, adopts the native migration ledger, or publishes the app.
