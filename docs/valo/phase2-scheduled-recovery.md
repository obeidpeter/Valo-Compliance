# Scheduled development recovery and host supervision

This increment adds hourly development backups with a separately retained current
privacy journal, bounded restore extraction, and a Linux outer process manager for
the API and worker supervisor. Production activation still fails closed through the
existing production preflight. No migration, customer execution, production database,
new paid hosting or public deployment is part of this change.

## Verified development recovery

PR #36 was merged into `feature/valo-p0-foundation` as
`c12839e75a7e65fad73c5d8f1fcd2da91dadfb0d`. Its native merge retained the seven preview
overrides and the two approved non-secret settings. All five native export/cleanup
smoke groups passed; API and worker readiness returned 200. The native runtime is
`368fe0bc9342351b57d9ed63a7362b31d5fa60ce`. The native migration ledger remains unchanged.

The November 15 rehearsal captured a read-only PostgreSQL snapshot at 22:25:28 UTC
and a separate current privacy journal at 22:25:39 UTC. Both were encrypted with
restic, stored in the approved private development B2 prefix, and independently
read back without a cache. The journal is a distinct restic snapshot, signed with a
domain-separated HMAC. It includes privacy/erasure tables, memberships and staff
assignments. Its source identity, snapshot cutoff, maximum age, key fingerprint,
MAC and table shapes must all validate on the recovery host.

On the owner's separate Windows computer, independently saved provider credentials
downloaded both snapshots. Application signing keys were transferred using a random
AES-GCM key wrapped to a one-time RSA public key, then saved with Windows CurrentUser
DPAPI. Plaintext keys were never written to an agent-readable directory. A new,
owner-only PostgreSQL 16 cluster used SCRAM and listened only on 127.0.0.1. Verification
completed at 22:31:13 UTC:

- All 70 table fingerprints, schema, constraints, indexes, triggers and grants matched.
- All 36 private files (1,059,668 bytes) matched their captured hashes; 18 absent,
  nonreadable reservations stayed nonreadable.
- The independent journal authenticated and matched the restored control tables.
  No newer control changes required replay in this particular snapshot.
- The registered privacy signing key matched; restored non-owner roles could not log in.
- Dispute update/delete denial survived restore; the migration ledger stayed unchanged.
- No app, worker or external execution started. The cluster stopped and temporary
  plaintext credentials, restored databases and downloaded recovery data were removed.

Row fingerprints explicitly use UTC, avoiding differences caused by the Windows
host's local timezone. This is actual separate-host development recovery evidence.
It does not prove production recovery, replay of newly changed native erasures, a
production RTO, or continuous recovery with zero data loss.

## Backup execution and monitoring

Build/capture requirements: Linux, Python 3.11+, Node and locked application
dependencies, PostgreSQL 16 client tools, restic, the native private storage SDK's
authenticated loopback sidecar, and the source Git checkout. Source database work
uses a read-only repeatable-read transaction and an exported snapshot for pg_dump.
Files use snapshot hashes and immutable private object identities. Missing required
bytes, unknown signing keys, source identity drift or a changed release fail capture.

Create a private mode-0600 JSON config with exactly these fields:

```json
{
  "version": 1,
  "sourceRoot": "/absolute/canonical/source",
  "stateDirectory": "/absolute/private/state",
  "sourceIdentitySha256": "<reviewed database identity SHA256>",
  "releaseSha": "<exact checked-out 40-character commit>",
  "credentialExpiresAt": "<verified provider key expiry in UTC>"
}
```

Keep the state directory owner-only (0700), outside the Git tree or in an ignored
operator directory. Privately supply `NODE_ENV=development`, `DATABASE_URL`,
`SESSION_SECRET`, optional `VALO_PRIVACY_KEYRING`, `PRIVATE_OBJECT_DIR`, approved
`RESTIC_REPOSITORY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`VALO_RESTIC_PASSWORD`, and a distinct `VALO_BACKUP_MONITOR_URL`. No secret belongs in
the config, command line, PR or receipt. Credentials and process startup hooks are
excluded from subprocesses that do not need them.

```sh
python3 scripts/ops/backup_cycle.py /private/configuration.json
python3 scripts/ops/backup_scheduler.py /private/configuration.json
```

Use one scheduler or one approved host timer, never both. Cycle and scheduler locks
prevent overlap. The workspace scheduler runs immediately, then at most once per
hour, without burst catch-up. It rechecks the pinned source and credential expiry.
The provider key must have more than two hours left. The current development key
expires November 22, 2026 at approximately 21:26 UTC; rotate it and update independent
custody and the verified expiry before that boundary.

A cycle sends a bodyless start signal, captures and verifies the database/object
archive, then captures and independently verifies the newer privacy journal. It
removes temporary plaintext before sending success. Failed capture, transport,
journal verification, expiry or monitor delivery never emits a successful backup.
Receipts distinguish transport verification from signature validation and erasure
replay. No automatic repository initialization, snapshot pruning or policy change
occurs. Preserve independent keys and older snapshots during code rollback.

The development backup check sends notifications to the approved operator address
with a one-hour period and 15-minute grace. A workspace that sleeps or loses its
scheduler will miss that external deadline. A running workspace loop is not an
always-on service or proof that the next hourly run has occurred. Its commands and
private configuration survive workspace restart, but the host/workflow must restart
the processes. Do not describe this as a production schedule or host restart guarantee.

The `systemd/valo-development-backup.*` files provide a reference timer contract for
an approved compatible Linux host. They are not installed automatically. A generic
separate VM lacks Replit's storage sidecar; do not deploy this capture there without
an approved supported storage authentication path. Provider free-tier caps remain
in force; no new billing approval or retention policy is implied.

## Outer runtime supervision

`runtime_host.py` pins a release and privately configured source/state directory,
owns one advisory lock, starts the built API and worker supervisor, and excludes B2,
restic and backup-monitor credentials from both. It permits at most three restarts
per service per ten minutes. Before replacement it confirms the old process group
has drained. It records PID/start-time identities so a reused PID is not signalled.
Unconfirmed old groups fail closed rather than permitting duplicate workers.

The Linux exec wrapper sets a parent-death signal before exec and checks the parent
identity again to close the startup race. Loss of the outer manager terminates the
API and supervisor; the existing worker IPC-loss handler drains its worker. Normal
shutdown gives each process group 90 seconds. The reference host unit allows 200
seconds for both groups, bounds host restarts, and uses a private filesystem and
control-group cleanup. See the upstream [systemd termination semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html)
and [timer semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

Its private JSON config uses exactly `version`, `sourceRoot`, `stateDirectory`,
`releaseSha`, and `mode` (`development` or `production`). Supply the appropriate
environment privately; the configured mode must equal NODE_ENV. Start with:

```sh
python3 scripts/ops/runtime_host.py /private/runtime.json
```

For production the manager executes the **full** built production preflight before
starting either service. That gate currently declines activation. It never uses
`--configuration-only`, changes the environment to development, or bypasses existing
export/queue/privacy guards. The reference service is a supervision contract, not an
installed or approved production deployment. The frontend ingress process remains
a separate deployment concern and must be wired into the eventual host contract.

## Remaining launch gates

1. Complete production runtime activation across export creation/download, queue,
   cleanup, privacy and operations using the production storage adapter. Verify a
   separate initialized production database, signing keys and immutable release.
2. Approve the concrete always-on host, geography and recurring budget before
   provisioning. Configure its outer restart/termination contract and private ingress.
   Run storage probes, queued-work restart/drain and session-denial checks there.
3. Retain and replay a genuinely newer authenticated erasure/revocation journal on a
   separate host, including interrupted replay, physical deletion and stale-key denial,
   before opening any restored app. A matched journal is not evidence of changed-row replay.
4. Prove an elapsed backup-specific missed-run alert on the eventual always-on host.
   Controlled source-identity failure and subsequent verified recovery produced DOWN
   and UP emails around 23:40 Africa/Lagos on November 15; the owner confirmed both.
5. Agree production RPO/RTO, retention/pruning and recurring isolated recovery cadence.
   Current hourly captures have a recovery gap; they are not a transactional erasure outbox.

No SQL migration is introduced. For development rollback, stop the scheduler, let
any read-only cycle finish, stop the outer manager and confirm both child groups
exited, then start the prior built API and supervisor. Preserve B2 snapshots, keys,
receipts and all source database rows. Monitoring should remain active so an absent
backup or worker produces an alert rather than an apparently healthy rollback.

The reviewed candidate was installed in development under ignored operator
directories. Its first hourly-scheduler cycle verified at 22:37:51 UTC on November 15.
One API, one supervisor and one worker were observed healthy; the previous processes
drained without forced termination. Serving process environments excluded backup
credentials. All 21 Python operations tests and both journal-authentication tests
passed on the native Linux host. This observation covers the installed development
candidate, not a deployed production worker or an elapsed second hourly interval.
