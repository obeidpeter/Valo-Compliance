# Merge security, log privacy and isolated development recovery

This is partial engineering evidence, not R1/R2 acceptance or production approval.
The review merge `14b1d5283eeb667800a48561b032cd1476bb92e6` was already an
ancestor of this work. Its findings and source documents were preserved.
The retained NAFDAC PDF is 31,142 bytes and has SHA-256
`3099b153d913872ef0d839110a65c8451f758d145eeadd54ebc2f049ff663f07`.
That establishes file identity, not legal currentness or publication eligibility.

## Merge checks

`valo-foundation.yml` now triggers on main pushes (including actual merges),
feature pushes and PRs to main. Separate security jobs run frozen-lock dependency
audit, pinned Gitleaks and pinned Semgrep. Secret and static detectors have
harmless generated source/data canaries; those are never issued credentials or
executed code. Reports retain locations/counts, not matched secrets or source.
New checks exist in the workflow; their GitHub execution must be observed.
No main merge, rule enforcement or approval is inferred from local execution.

Four exact immutable historical Gitleaks fingerprints are excluded, not whole
files, rules or future commits. Three identify SHA-256 fields for generated API
contracts in `source-acceptance-checkpoint.json`; one is the `apiUnit` SHA-256
field in `p0-customer-execution-checks.json`. Their values were checked to be
64-character hexadecimal evidence digests. Arbitrary future hexadecimal keys
are **not** excluded. Canaries must still fail.

The Phase 1 merge also retains four exact source-file digest dispositions,
recomputed from their original Git blobs by `merge-security-dispositions.ts`.
CI identified one additional historical finding at
`ef8e47513add00c3bb58fa14ecbc9fffe71cc171`, line 32 of
`docs/valo/evidence/finite-sdk-admission-result.json`. Its
`apiTypecheckLogSha256` value independently matches SHA-256 of the ordinary
pnpm API typecheck banner, including its leading/trailing newlines. The verifier
reconstructs those harmless bytes and compares them with the immutable evidence
line on every scan. Only that exact commit/file/rule/line fingerprint is excluded;
new findings in the same file remain subject to scanning. This verifies digest
identity, not the historical command's success or current application readiness.

```sh
pnpm --filter @workspace/scripts exec tsx src/valo/merge-security.ts
bash scripts/src/valo/merge-static.sh # requires the pinned scanner
pnpm --filter @workspace/api-server test:valo-operations
```

Actual HTTP tests use Express, the shared application logger and the application
error handler. They submit private synthetic markers in paths, queries, bodies,
authorization/cookies and thrown errors. Captured JSON records retain request IDs,
methods, statuses and safe error types. They exclude URL paths, raw exception
names/messages/stacks and request contents. The positive leak canary proves the
test would notice a marker. This is not managed-identity/browser acceptance.

## Internal development readiness

The development worker emits a project-local heartbeat and runs bounded read-only
database/backlog/cleanup/missing-grant-or-receipt probes. Internal alert transitions
are atomic, lock-protected and persisted under the ignored private
`generated-artifacts/valo-operations` directory. The journal retains at most 1,000
transitions; this is **not** the proposed long-term audit/retention system.
No email/HTTP notification transport is attached. Failed probes are unavailable,
never zero. A dead, old, future-dated or malformed heartbeat is not healthy.

```sh
pnpm --filter @workspace/api-server valo:operations-probe
```

Current development measurement found **94 synthetic verified-success orders
with grants but no purchase-receipt outbox**. The monitor raised and retained an
internal alert; it did not invent receipts, verify with a merchant or change money.
This is an unresolved development-fixture/ledger finding, not a live-payment
incident. A nonzero readiness exit is intentional while this finding exists.

The heartbeat/alert transport is development-project-local. A distributed
production monitor, external uptime checks, incident-response ownership and
production storage/delivery remain unproved; sharing a development filesystem
does not prove communication between separate deployments.

## Isolated recovery

```sh
pnpm --filter @workspace/api-server test:valo-isolated-recovery
```

This creates a disposable local PostgreSQL cluster on a private Unix socket,
applies the actual journalled migrations, saves three synthetic customer drafts
using the real store, and creates three real DOCX **fixture objects**. It exports
one explicitly identified snapshot and restores into a separate local database.
It does not connect to, dump, copy or restore the managed development/production
database. It is not an application backup feature or scheduled backup.

A separate HMAC-bound post-cutoff control journal replays identity revocations and
deletion access quarantines. Tests reject a changed journal and the source DB as
the replay target, repeat replay without duplicate tombstones, verify actual
membership resolution and cross-tenant denial, compare tenant/revision/object
hashes, detect altered object bytes, and remove a quarantined fixture object
idempotently. Private document access for the unaffected identity is recovered.
Charge/refund/email boundaries reject recovery mode before transport; no
dispatchers are started and provider credentials are not inherited by children.

**Limitations:** access quarantine is not completed application/provider erasure.
The fixture store is not Replit App Storage. Both disposable DBs share a local
cluster whose roles were provisioned by the migrations; this does not prove
restoring production roles into a new provider environment. Recorded elapsed
times and snapshot cutoff/LSN are observations, not production RPO/RTO promises.
No retained managed-data backup system has been added.

## Retention and remaining gates

The proposed **35-day** rolling recovery target remains unresolved. Official
Replit data-recovery documentation rechecked during this checkpoint describes
7-day default PITR and up to 28 days on eligible plans; this does not establish
this account's settings or satisfy 35 days. No upgrade is authorized. A supported
design meeting the target or an explicitly approved specification change is
required before that gate can pass.

Local tests/scans do not accept the independent technical assessment, source
currentness, commercial/privacy decisions, real PSP/email execution, formal
80/60/60 evaluations, R1 or R2. All existing launch/live-payment/inference holds
and identity/daily quotas remain unchanged.
