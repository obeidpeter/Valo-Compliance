# Phase 2: private storage and worker readiness

This increment prepares production storage isolation and makes worker health reflect
successful work. It does not activate production exports, start a production worker,
change a deployment, or apply a database migration. Customer export paths and the
worker still reject production through the existing runtime guards.

## What changes

- The server-owned `productionPrivateStorage` adapter requires an explicit production
  root and accepts only canonical `valo/production/<workspace UUID>/<asset UUID>` keys.
  Development uses its own namespace. The adapter verifies write/read checksums and
  refuses existing keys; callers must mint a fresh random asset UUID for every attempt.
  The SDK has no conditional-create primitive, so this is not a general-purpose
  concurrent overwrite API. Production customer routes and streamed workspace exports
  are not wired to this candidate adapter yet.
- Production and development roots cannot be equal, ancestors, or descendants in the
  same bucket. The production root never falls back to `PRIVATE_OBJECT_DIR`.
  Roots are server-only configuration, not client-visible URLs or access credentials.
- The opt-in storage canary writes synthetic bytes in a separate readiness prefix,
  verifies exact privileged read-back and anonymous denial, then deletes and checks
  absence. Its cleanup command cannot address customer keys.
- Worker heartbeats now carry a process instance, phase, and last successful dispatch.
  Failed dispatches and queue errors no longer produce a healthy timestamp. Both
  queues must be reachable with their reviewed settings even when there is no work.
- The build includes `dist/export-worker.mjs`, `dist/production-preflight.mjs`, and
  `dist/production-storage-probe.mjs`, alongside the API and logger helper bundles.

## Candidate hosting and configuration

Replit documents that Autoscale can scale to zero, while Reserved VM supports an
always-running process. The candidate contract here is one supervised worker in the
same Replit app on Reserved VM. That colocation is our deployment choice: it avoids
assuming that an independent app can access the original app's storage bucket.
The existing Autoscale deployment configuration is unchanged and does not satisfy
this contract. Sources: [deployment types](https://docs.replit.com/features/publishing/deployment-types)
and [App Storage](https://docs.replit.com/features/data-and-storage/object-storage).

| Variable | Required candidate value |
| --- | --- |
| `NODE_ENV` | `production` for the production preflight and storage probe |
| `PRIVATE_OBJECT_DIR` | Existing development root, retained for overlap detection |
| `VALO_PRODUCTION_PRIVATE_OBJECT_DIR` | Separate private bucket/prefix, e.g. `/bucket-id/production-private` |
| `VALO_WORKER_TOPOLOGY` | `replit-reserved-vm-same-app` |
| `VALO_WORKER_REPLICAS` | `1` |
| `VALO_RELEASE_SHA` | The exact 40-character lowercase Git commit deployed |
| `VALO_WORKER_HEALTH_PORT` | Dedicated local port, 1–65535, distinct from API/frontend |
| `VALO_PRODUCTION_STORAGE_PROBE` | `synthetic-canary-only`, only while running the probe |

These declarations do not inspect the deployment or count running processes. A
passing configuration check is not evidence of supervision, private access, database
separation, processor geography, backup retention, or release approval.

Build with `pnpm --filter @workspace/api-server run build`. Inspect configuration with:

```sh
pnpm --filter @workspace/api-server valo:production-preflight
pnpm --filter @workspace/api-server valo:production-preflight --configuration-only
```

The default command exits **2** when configuration is valid but launch evidence is
still outstanding, and **1** for invalid configuration. Only the explicit
`--configuration-only` mode returns **0** for valid configuration. All reports retain
`launchReady: false`, `customerExportsEnabled: false`, and
`workerActivationEnabled: false`. This command performs no network or database I/O.

## Storage verification after provisioning

Run only against the intended production candidate from its server environment, with
the approved root supplied privately through deployment configuration:

```sh
pnpm --filter @workspace/api-server valo:production-storage-probe --start
pnpm --filter @workspace/api-server valo:production-storage-probe --cleanup <run-uuid>
```

The first JSON line records the random run UUID and storage fingerprint before any
provider operation. Retain it and the final report in the restricted deployment
record. A fresh probe refuses to reuse an existing key. Cleanup derives only
`<production root>/valo/production/readiness/<run UUID>/canary.bin`; it is idempotent.
No bucket locator, credential, customer ID, or provider exception is printed.

A successful start requires write/read checksum agreement, anonymous HTTP 401/403/404,
and a confirmed absence after deletion. A timeout, network error, public response,
or unconfirmed cleanup fails. Anonymous denial alone is insufficient; the same object
must first have been read successfully through the privileged SDK.

The process has a 90-second deadline. A timed-out SDK operation can have been accepted
by the provider and cannot be recalled by terminating Node. Keep its run UUID, stop
the previous process, and rerun cleanup after the in-flight operation has settled;
recheck for a late arrival. A cleanup receipt is point-in-time evidence, not a durable
customer-erasure tombstone. Do not discard an unresolved receipt or substitute this
canary for the existing privacy erasure/replay procedure. It contains synthetic data
only and never shares a customer key.

Replit currently documents private buckets with public-access prevention, but does
not support App Storage lifecycle policies, object versioning, or retention policies.
The candidate probe cannot establish those capabilities. The production backup and
retention design remains a release gate. [App Storage documentation](https://docs.replit.com/features/data-and-storage/object-storage)

## Worker readiness and shutdown

`pnpm --filter @workspace/api-server worker:start` runs the built entry. It is still
development-only; changing environment flags is not a production rollout procedure.
With `VALO_WORKER_HEALTH_PORT` set, the worker binds **127.0.0.1 only**:

| Request | Meaning |
| --- | --- |
| `GET /healthz` | 200 while the process runs; 503 after draining starts |
| `GET /readyz` | 200 only after successful dispatch and while success is at most 90 seconds old; otherwise 503 |

Replies contain only a status and `Cache-Control: no-store`. Failed dispatches, queue
errors, and operational-dispatch failures make readiness fail. A hung dispatch ages
out after 90 seconds. Do not expose this port through the public reverse proxy. A
bounded supervisor candidate now checks child-bound health reports and restarts an
unresponsive worker; see [worker supervision](phase2-worker-supervision.md).
Deployment still needs an outer process manager and external alert delivery; the
local heartbeat/alert files are not an external monitor. The opt-in independent
monitor and provider provisioning steps are in [infrastructure setup](phase2-infrastructure-setup.md).

Every dispatch verifies the existing `valo_jobs` queues:

| Queue | Retry limit | Expiration seconds |
| --- | --- | --- |
| `valo-manual-export-v1` | 2 | 120 |
| `valo-workspace-data-v1` | 0 | 360 |

The worker never migrates or repairs queues at startup. Drift leaves readiness failed
until reviewed configuration is restored. Cleanup backlogs have separate operational
alerts; worker readiness is not a claim that all retained cleanup or privacy holds
have cleared.

SIGTERM/SIGINT immediately enters draining, stops new dispatches, and allows the
queue's graceful stop up to 60 seconds. The overall shutdown deadline is 70 seconds;
an unresolved database/SDK promise forces exit 1. Keep a supervisor termination grace
period above 70 seconds. Retained queue leases and upload reservations remain owned
by the existing recovery paths. Linux CI tests the real signal handler; Windows
terminates Node directly and cannot prove POSIX signal handling.

## Validation and release sequence

CI now exercises root isolation, the actual adapter with a controlled native SDK,
canary failure/cleanup paths, health freshness and error races, real loopback HTTP,
bounded shutdown in child processes, and the built operator commands. Disposable
PostgreSQL tests start the actual worker, introduce queue drift, observe 503 without
a refreshed success timestamp, repair it, then drain/restart. The existing real-worker
crash and private-file recovery suite remains required.

After this PR is reviewed and merged, the remaining production work is:

1. Provision the separate private root and always-on same-app topology; record the
   exact release, process supervisor, and secret/configuration ownership.
2. Run the deployed storage canary and retain successful cleanup evidence. Resolve
   any outstanding run UUID before proceeding.
3. Validate production database separation and reviewed queue installation in an
   isolated rehearsal; complete a separate runtime activation change covering all
   production export, cleanup, download, privacy and operations paths.
4. Prove supervised worker restart and drain with queued synthetic work, external
   alert delivery, and deployed restore plus erasure replay. Agree supported backup,
   retention and geography arrangements before release approval.

No new SQL migration is included. Development rollout needs the existing migration
0033 and reviewed queues already installed. Rollback means restoring the previous
application build; there is no down migration and no customer-object deletion step.
This document and CI provide code-level preparation, not deployed production proof.
