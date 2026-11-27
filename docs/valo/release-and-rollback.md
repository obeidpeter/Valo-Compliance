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
5. The release record is kept with them (OPS-005). Run
   `pnpm --filter @workspace/api-server exec tsx src/scripts/release-record.ts <sha>`
   in the clean checkout of the release commit against the database the release runs on.
   It records:
   - the commit;
   - the migrations the release ships and those the database has applied, and whether they match;
   - every content version with its status: the reviewed route's versions and the staff library's
     drafts, releases, replacements and withdrawals (decision 0018), by identity and digest;
   - every rule version with its status and how it was released: on the reviewed route or on the
     owner's sign-off (decision 0020);
   - the known issues in `docs/valo/known-issues.json` as committed.

   It only reads. Update the known issues before the release commit.
6. The owner has approved the deployment.

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

## Backup retention (policy approved; removal built, not run)

No backup has been pruned. Retention decides how long erased customer data
survives in backups, so it is an owner decision. The product owner approved the
policy below on 2026-11-20, in the instruction "I approve everything that needs
approval". The preflight's `RETENTION_POLICY_AND_RELEASE_APPROVAL` stays unmet:
it also asks for a release approval, and no launch is approved. The policy:

- keep every snapshot from the last 48 hours;
- keep the newest snapshot of each UTC day for 35 days;
- remove anything older, so erased data leaves the backups within 35 days.

Database archives and privacy journals are planned separately, and the newest of
each is always kept. If a group's newest snapshot is older than 48 hours, backups
have stopped, and that group keeps everything until a backup succeeds again.

`scripts/ops/backup_retention.py` applies this policy to the output of
`restic snapshots --json` and prints what it would keep and remove. It needs no
credentials and deletes nothing.

`scripts/ops/backup_removal.py` is the separate step that removes. An operator
runs it by hand, never on a timer:

1. Plan: run `restic snapshots --json` against the repository, then
   `backup_retention.py` on that listing, and save the plan as a private file.
2. Review the plan, and take its SHA-256.
3. Remove: `python3 scripts/ops/backup_removal.py <plan.json> <sha256> --operator <name> --reason "<why>"`,
   with the repository's environment set as for the recovery archive
   (`VALO_RECOVERY_ARCHIVE_MODE`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`) and
   `VALO_OPERATOR_JOURNAL` naming the operator's private journal directory.

The command refuses a plan whose bytes do not match the hash, one made under
another policy, and one more than a day old. It reads the snapshots again and
plans again. It removes nothing unless each snapshot the reviewed plan removes
still exists and is still due, and nothing from a group whose backups have
stopped. It then runs `restic forget` on exactly those snapshots and
`restic prune`, reads the snapshots once more, and fails unless the removed ones
are gone and every kept one remains. Its tests run against a real restic
repository in CI. It has not been run against a real backup repository: none is
deployed.

## The operator's journal

The tools that remove or restore backups record who ran them and why (ADM-009,
[the audit trail](../architecture/audit-trail.md)). `backup_removal.py` and
`recovery_restore.py` refuse to run without `--operator` (a short handle, never an
email address) and `--reason` (one line, 20 to 1000 characters), and without
`VALO_OPERATOR_JOURNAL`: an absolute directory private to the account running
them, apart from the plan's folder and from a restore's new directory.

Each writes a `started` entry to `operator-journal.jsonl` there before it acts,
and a `completed` or `failed` entry afterwards. Each entry holds the hash of the
one before it. Check a journal with
`python3 scripts/ops/operator_journal.py verify`. If the chain is broken the tools
stop: keep the damaged file as evidence, start a new journal directory, and give
the reason in the next run's `--reason`. Keep each run's printed receipt, which
names the hashes of its entries.

Unpack a pinned recovery archive with
`python3 scripts/ops/recovery_restore.py <archive> <new directory> <sha256> --operator <name> --reason "<why>"`.

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
| `PAYMENT_DIFFERENCES_DETECTED` | Any order whose latest finished daily payment check found a difference: an amount, a transaction, a reversal, a grant, a receipt or a missing event, or no answer from the provider after three attempts | Internal operations sample (PAY-007) |
| `PRIVACY_REQUESTS_BACKLOG` | Any privacy request still open 14 days after it was made: the date Valo aims to finish it by, Valo's own aim and not a time limit set by law | Internal operations sample (PRV-003) |
| `REMINDERS_BACKLOG` | Any reminder email still pending fifteen minutes past its time | Internal operations sample (NFR-010) |
| `JOB_QUEUE_BACKLOG` | Any scheduled job still waiting ten minutes past its start | Internal operations sample (NFR-010) |
| `MESSAGES_BACKLOG` | Any message to a customer still queued fifteen minutes past its time, or still marked as being sent fifteen minutes after its attempt's lease ended; a held one is not counted | Internal operations sample (WRK-003) |
| `FAILED_MESSAGES_DETECTED` | Any message to a customer that failed in the last day | Internal operations sample (WRK-003) |
| `NEW_ENQUIRIES_DETECTED` | Any enquiry nobody has taken: its case is open | Internal operations sample (SRV-002) |
| `WAITING_ENQUIRIES_DETECTED` | Any enquiry waiting on Valo, open or in progress, that nobody has touched for more than 48 hours: Valo's own aim, and no promise to anyone | Internal operations sample (SRV-002) |
| `REQUEST_FAILURES_DETECTED` | More than 10 in 1,000 of the API's requests failed unexpectedly in the last ten minutes, once there are a hundred requests or more | Internal operations sample (NFR-003) |
| `REQUEST_TIME_DETECTED` | 95 in 100 of the API's requests in the last ten minutes did not all finish within a second, once there are a hundred requests or more | Internal operations sample (NFR-003) |
| `DENIED_ACCESS_DETECTED` | One hashed address was refused (401 or 403) more than 20 times in ten minutes | Internal operations sample (SEC-008) |
| `SIGNATURE_FAILURES_DETECTED` | Any payment or email webhook signature was rejected in the last ten minutes | Internal operations sample (SEC-008) |
| `SPREAD_REFUSALS_DETECTED` | Every hashed address together was refused (401 or 403) more than 100 times in ten minutes | Internal operations sample (SEC-005) |
| `LIMITED_CALLERS_DETECTED` | A limit refused (429) more than 10 hashed addresses in ten minutes | Internal operations sample (SEC-005) |
| `REFUSED_INPUT_DETECTED` | One hashed address sent more than 20 requests whose input was refused (400, 413, 415 or 422) in ten minutes | Internal operations sample (SEC-008) |
| `ROLE_CHANGES_DETECTED` | Any staff role was granted or revoked in the last hour | Internal operations sample (SEC-008) |
| `BULK_EXPORTS_DETECTED` | Any caller used its whole export quota window | Internal operations sample (SEC-008) |
| `PAYMENT_ACTIVITY_DETECTED` | Any caller used its whole checkout or refund quota window | Internal operations sample (SEC-008) |
| `AI_ACTIVITY_DETECTED` | Any caller used its whole AI quota window | Internal operations sample (SEC-008) |
| `CHECKOUTS_DETECTED` | More than 50 checkouts began in the last hour, every workspace together | Internal operations sample (SEC-005) |
| `CHECKOUT_AMOUNT_DETECTED` | The checkouts begun in the last hour came to more than ₦1,000,000 | Internal operations sample (SEC-005) |
| `REFUNDS_DETECTED` | More than 5 refunds were asked for in the last hour, every workspace together | Internal operations sample (SEC-008) |
| `REFUND_AMOUNT_DETECTED` | The refunds authorised in the last hour came to more than ₦100,000 | Internal operations sample (SEC-008) |
| `AI_SPEND_DETECTED` | The drafts of the last hour used more than a quarter of the drafting assistant's daily allowance in all | Internal operations sample (SEC-005) |
| `WORKSPACE_DOWNLOADS_DETECTED` | More than 10 whole-workspace downloads were asked for in the last hour | Internal operations sample (SEC-008) |
| `STAFF_COPIES_DETECTED` | Privacy staff prepared more than 5 copies of a workspace's data in the last hour | Internal operations sample (SEC-008) |
| `GUARD_REFUSALS_DETECTED` | A database guard refused an application request in the last ten minutes: a fault, or an attempt to change a history | Internal operations sample (ADM-009) |
| `PRIVILEGED_READING_DETECTED` | One staff member read more than 100 distinct records or lists in the last hour | Internal operations sample (ADM-009) |
| `HISTORY_INTEGRITY_DETECTED` | The latest hourly count found a history whose digest no longer matches its rows, or whose digest trigger is missing or off: a change made outside the application | Internal operations sample (ADM-009) |
| `<NAME>_PROBE_UNAVAILABLE` | A probe query fails or times out (2 seconds) | Internal operations sample |

Each internal alert names its runbook and accountable roles from
[operating-runbooks.md](operating-runbooks.md); the security alerts' thresholds
are development defaults, not reviewed values.

Internal alerts are recorded with active and resolved events. Any active
internal alert stops the operations check from reporting success, so it reaches
the operator through the external check.

Errors are logged as structured events without messages or customer data
(`safe-error.ts`). An external error tracker would be a new dependency and a new
processor of operational data, so it needs owner approval.

A caller that waits more than 10 seconds for a database connection fails instead
of waiting forever; an API request then gets the generic 503. Its log entry
carries `DB_POOL_ACQUIRE_TIMEOUT` when every pooled connection was busy, or
`DB_CONNECT_TIMEOUT` when the database did not answer a new connection. Repeated
pool timeouts mean connections are held too long: look for long transactions or
a transaction that waits on a second connection.

`DB_WORKSPACE_SCOPE_UNAVAILABLE` means customer requests, or the worker's jobs for one
workspace, cannot enter a workspace scope. Check, in order: the row security migration is applied;
`VALO_CUSTOMER_DATABASE_URL` is set, names the same database as `DATABASE_URL`, and
logs in as `valo_workspace_login` with its current password; the login can log in
(`lib/db/scripts/workspace-login.mjs` enables it); and the application role can
insert into `valo_scope_keys`, where each process registers its signing key. Every
customer request, export and reminder fails until it is fixed; no connection is leaked. Apply the
migration and enable the login (see `docs/valo/migration-workspace-row-security.md`)
before releasing code that expects them. The database refusing the login gives the same code: a
rotated password the process has not been given yet, or an emergency revocation
(`docs/valo/secret-rotation.md`).

`VALO_PUBLISHER_LOGIN_UNAVAILABLE` means a content version could not be released because the
publisher's own connection is missing or wrong. Check, in order: the publisher login migration is
applied; `VALO_PUBLISHER_DATABASE_URL` is set for the command that publishes, leads to the same
host, port and database as `DATABASE_URL`, and logs in as `valo_publisher_login` with its current
password; and the login can log in (`lib/db/scripts/publisher-login.mjs` enables it). A release
refused with error code `42501` and "published only by a session that logged in as
valo_publisher_login" was attempted on another connection: the database publishes a version only
for the publisher's login. Nothing else uses the login, so preparing, reviewing, holding,
withdrawing and reading content are unaffected (see `docs/valo/migration-publisher-login.md`). The
database refusing the login, after a rotation or an emergency revocation, gives the same code
(`docs/valo/secret-rotation.md`).

`VALO_DRAFTER_LOGIN_UNAVAILABLE` means a candidate could not be prepared or saved because drafting's own
connection is missing or wrong. Check, in order: the drafter login migration is applied;
`VALO_DRAFTER_DATABASE_URL` is set for the command that prepares, or for the worker, leads to the same
host, port and database as `DATABASE_URL`, and logs in as `valo_drafter_login` with its current
password; and the login can log in (`lib/db/scripts/drafter-login.mjs` enables it). The worker records
the code on the preparation request it could not carry out; ask for it again once the login works. A
candidate refused with error code `42501` and "added only by a session that logged in as
valo_drafter_login" was added on another connection: the database adds content only for drafting's
login. Holding, withdrawing, publishing and reading content do not use it (see
`docs/valo/migration-drafter-login.md`). The database refusing the login, after a rotation or an
emergency revocation, gives the same code (`docs/valo/secret-rotation.md`).

`VALO_REVIEWER_LOGIN_UNAVAILABLE` means an AI review could not record its attempt because review's own
connection is missing or wrong. It stops the review before an attempt is reserved or a model is called.
Check, in order: the reviewer login migration is applied; `VALO_REVIEWER_DATABASE_URL` is set for the
command that runs the reviews, leads to the same host, port and database as `DATABASE_URL`, and logs in
as `valo_reviewer_login` with its current password; and the login can log in
(`lib/db/scripts/reviewer-login.mjs` enables it). An attempt refused with error code `42501` and
"recorded only by a session that logged in as valo_reviewer_login", or "as valo_drafter_login" for a
drafting attempt, was recorded on another connection: the database records each AI attempt only for its
own login. An attempt is never removed and the table cannot be emptied. Preparing a candidate without
reviews, publishing and reading content do not use the login (see
`docs/valo/migration-reviewer-login.md`). The database refusing the login, after a rotation or an
emergency revocation, gives the same code (`docs/valo/secret-rotation.md`).

`db.connection_failed` in the API's or the worker's log is a pooled connection that failed while idle,
with its login and code: the pool dropped it and the next query opens another. Many at once, with
`57P01`, are sessions an operator ended, as in an emergency revocation, or a database restart.

A write to a history that ended in a deadlock (`40P01`), on a database without the history digest
changes migrations, met another writer on its history's digest rows: there each write holds the digest
row it changed until its transaction ends. Apply the migrations (see
`docs/valo/migration-history-digest-changes.md`). After them each write adds its change as a row of its
own, and no write to a history waits on another's digest.

A message that stays `held` in `valo_messages` says why in its `reason`. `SENDER_NOT_CONFIGURED` means
the worker has no sender: `VALO_MESSAGE_SENDER` is unset, as it is unless a stand-in is wanted.
`MESSAGES_PAUSED` means the staff safety pause on sending is on. Neither is a fault, and the message is
offered once the cause is gone. A `failed` message was offered five times and not taken, or its sender
could no longer tell a retry from a new message; it raises `FAILED_MESSAGES_DETECTED` for a day. No
message reaches anyone: the only sender is a stand-in that sends nothing (see
`docs/architecture/messages.md` and `docs/valo/migration-messages.md`). A message the stand-in took is
`accepted` in the table, and the workspace's log calls it recorded and "Not emailed".

What the email provider reports about a message it took arrives at `POST /api/webhooks/email`, which
answers 503 unless the runtime is development and `VALO_EMAIL_WEBHOOK_SECRET` is set. A report whose
signature fails is logged as `email.signature_rejected` and counted for `SIGNATURE_FAILURES_DETECTED`,
with the payment webhook's: check that the secret is the one the provider shows for this webhook. A
signed report Valo cannot read is logged as `email.event_unreadable`, and means the provider's form has
changed. A report waits in `valo_email_events` as `pending` until the worker's `messages` task records
it. One still `pending` after an hour names a message Valo does not hold, and is settled as `unmatched`.

A reminder that is `cancelled` with the reason `EMAIL_ADDRESS_SUPPRESSED` was for an address Valo has
stopped sending optional messages to: its email service sent a message back for good, or one was marked
as spam there. It was never handed to the provider, and is not tried again. That reason on the reminder
is how staff see that an address is suppressed. The list itself, `valo_email_suppressions`, holds a keyed
checksum of each address and no address, so it cannot be read back into one. A suppression ends by
itself 180 days after the last report about its address, when the worker's `messages` task removes it.
There is no command to end one sooner: record a customer's request to on their support case. Ending one
by hand is not built, and would also need the address cleared from the provider's own list.

A reminder that stays `failed` as not confirmed, on a database that has `valo_email_suppressions` and
not the function `valo_email_address_suppressed`, could not ask whether its address is suppressed, and
was not sent. Apply the second suppression migration (see `docs/valo/migration-messages.md`).

Each reminder holds a link that turns its workspace's reminders off without sign-in
(`docs/architecture/messages.md`, part 4). The workspace's activity then has `reminders.stopped_by_link`
for the reminder that carried the link, and its consent history has the choice, as the owner's.
`unsubscribe.refused` in the API's log is a link Valo did not honour. The line does not say why, and
holds nothing of the link. The causes are these:
- it is not a link Valo made, or it was cut short;
- its key has left the keyring: `SESSION_SECRET` was changed, or a key was dropped from
  `VALO_PRIVACY_KEYRING`. That ends every link made under the key;
- it was made for someone who is no longer the workspace's owner;
- its workspace is gone, its owner's access is off, or its deletion is recorded.

`quota.denied` with the bucket `unsubscribe-link` is one workspace's links used more than ten times in
a minute (`VALO_LIMIT_UNSUBSCRIBE_LINK`).

A reminder that ends `failed` as not confirmed just after this release, or just after the keyring's
current key changed, may have been tried once before and once after. Its words differ across the
change, because its link does, and the provider's documentation says it refuses a retry whose content
differs from the first. The reminder went at most once.

A message of the kind `notices_digest` is one day's notices to a workspace of the changes that affect
it (`docs/architecture/messages.md`, part 7). The worker's `messages` task records the day in
`valo_notice_digests` from 07:00 the next morning on a Lagos clock, and queues the message to the
workspace's owner. What follows is not a fault:
- no message for a day whose only notice is a template replaced by a later edition: that notice is
  shown in the app only;
- no message for a notice more than a week old when the task first sees it, as after a worker was
  stopped for longer: the notice is on the Workspace page, where it has been since it was made;
- a message `cancelled` with the reason `NOTICES_NOT_FOUND`: the day's notices were gone when it was
  to be sent;
- no day recorded for a workspace whose deletion is recorded.

A `messages` task that fails each minute with `permission denied for table valo_notice_digests`, on a
database that has the table, lacks the second notice digests migration. Apply it (see
`docs/valo/migration-messages.md`). A `valo_notice_digest_day_ended` refusal in that task means the
worker's clock is more than seven hours ahead of the database's: correct the clock.

A customer request that answers the generic 503 with error code `42501` in its log
ran a command `valo_workspace_scope` does not hold: the code started using a table,
command or column before a migration granted it (`WORKSPACE_SCOPE_PRIVILEGES` in
`lib/db/scripts/workspace-row-security.mjs`). The log's frames name the query. Roll
the code back, or release the migration that grants exactly that; do not grant it
by hand.
