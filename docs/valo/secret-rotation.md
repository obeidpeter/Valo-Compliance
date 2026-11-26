# Rotating and revoking secrets

This runbook says, for each secret Valo uses, who holds it, how to rotate it, what rotating it changes,
and how to revoke it in an emergency. It is part 1 of [small hardening](../architecture/small-hardening.md)
(slice 2), for two requirements, verbatim from the specification:
- OPS-004, "Secrets and account ownership": "Keep secrets in environment-specific secret stores and
  managed provider accounts owned by Valo. Accept: no keys in prompts, browser bundles, commits or
  screenshots; rotation and emergency revocation are rehearsed."
- SEC-002, "Transport, storage and secrets": "Require HTTPS, secure cookies, managed encryption at rest
  and protected secrets. Accept: no secret-bearing client bundle; sensitive backups and storage objects
  are not publicly addressable; rotation tests pass."

What is rehearsed: the four database logins' rotation and emergency revocation, in CI, on every run
(below). Nothing else here has been rehearsed against its provider: those steps use the provider's own
dashboard, and no real secret has been rotated.

## For every secret

- **Where it lives.** In its environment's secret store and in the provider account it belongs to,
  owned by Valo: in development, Replit's Secrets; production's store is not chosen yet. Never in
  source, a commit, a prompt, chat, an issue, a log or a screenshot. The settings registry
  (`artifacts/api-server/src/platform/settings.ts`) marks each secret, and no secret has an example
  value; nothing the browser is sent may hold one (the bundle check, slice 1).
- **Who may hold it.** The owner, who administers the secret store and the provider accounts, and the
  processes named for it below. No one else needs it.
- **Making one.** A key Valo makes itself is at least 32 random bytes from a cryptographic source, such
  as `openssl rand -hex 32`. A database login's password is at least 24 printable ASCII characters;
  its script refuses a shorter one.
- **Rotating.** Make the new value, store it, restart what reads it, check that the work that needs it
  runs, and only then retire the old value.
- **In an emergency.** Revoke it at its source first, the database or the provider, then replace it
  and restart. Record who did it, which secret by name, when and why, outside customer logs.

## The database logins

Customer requests, publishing, drafting and review each connect with a login of their own
([service logins](../architecture/service-logins.md)). Each login has a script that enables it with a
new password, sent to the database only as a SCRAM verifier, and prints its connection string.

| Login | Connection string, and its password's setting | Held by | When the database refuses it, its work stops with |
| --- | --- | --- | --- |
| `valo_workspace_login` | `VALO_CUSTOMER_DATABASE_URL`, `VALO_WORKSPACE_LOGIN_PASSWORD` | The API and the worker | `DB_WORKSPACE_SCOPE_UNAVAILABLE`: every customer request, export and reminder |
| `valo_publisher_login` | `VALO_PUBLISHER_DATABASE_URL`, `VALO_PUBLISHER_LOGIN_PASSWORD` | The commands that publish | `VALO_PUBLISHER_LOGIN_UNAVAILABLE`: releasing a content version |
| `valo_drafter_login` | `VALO_DRAFTER_DATABASE_URL`, `VALO_DRAFTER_LOGIN_PASSWORD` | The commands that prepare, and the worker | `VALO_DRAFTER_LOGIN_UNAVAILABLE`: preparing a candidate; the worker records the code on the preparation's request |
| `valo_reviewer_login` | `VALO_REVIEWER_DATABASE_URL`, `VALO_REVIEWER_LOGIN_PASSWORD` | The commands that run reviews | `VALO_REVIEWER_LOGIN_UNAVAILABLE`: an AI review, before it reserves an attempt or calls a model |

The password settings are read only by the scripts; the application never reads them. The codes are in
the logs, with each failure's cause.

**To rotate one**, from the repository root, with the application's `DATABASE_URL`:
1. Make a new password and store it as the login's password setting.
2. Run the login's script, for example for the publisher:

   ```sh
   node lib/db/scripts/publisher-login.mjs --print-url
   ```

   The others are `workspace-login.mjs`, `drafter-login.mjs` and `reviewer-login.mjs`. Each reads the
   password from its setting and prints the connection string.
3. Store the printed string as the login's connection string, and restart what holds it: the API and
   the worker for the workspace login, the worker for drafting's. A command reads its connection when
   it starts.
4. Check that the work runs. A connection with the old password is now refused.

**What rotating changes.** The login's open sessions go on until they end. Any new connection with the
old password is refused, so until a process is restarted with the new string, the login's work there
stops with the login's code. Nothing else changes.

**To revoke one in an emergency**, as the application's login:

```sql
ALTER ROLE valo_publisher_login NOLOGIN;
```

Then end its open sessions, as a login that may end others' (a superuser, or a member of
`pg_signal_backend`):

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'valo_publisher_login';
```

The login can no longer log in, and its work stops with its code. The API and the worker carry on: each
session that ends is logged as `db.connection_failed`, with its login and code, and the work that does
not need the login goes on. If its sessions cannot be ended, they last until they close; new ones are
refused at once. **To restore it**, rotate it as above: its script lets it log in again.

**The rehearsal.** `src/platform/login-rotation.test.ts` (in `artifacts/api-server`, foundation job,
`test:valo-login-rotation`) does all of this for each of the four logins, on a PostgreSQL cluster of its
own that asks for passwords, with every migration applied. Rotating a login on the job's own database
would change it under the job's other tests, since a login belongs to the whole cluster. For each login:
- with the new password not yet given to the database, its work stops with its code;
- rotated with its script, the old password is refused and the new one works;
- revoked and its sessions ended, the ended session is reported and nothing is thrown, a new connection
  is refused, its work stops with its code, and the application's own connection goes on working;
- restored with its script, its work goes on.

Taking out the reporting of ended sessions makes the revocation steps fail; taking out the codes makes
the steps that expect them fail.

## The application's own login

`DATABASE_URL` is held by the API, the worker and the commands. Its login owns the tables. To rotate it,
change that login's password where the database is provided, store the new connection string, and
restart everything that holds it. Revoking it stops all of Valo, so in an emergency rotate it instead.

## Keys Valo makes itself

- **`SESSION_SECRET`** (the API, the worker and some commands). It keys the pseudonyms the request
  limits and the security signals count by. While `VALO_PRIVACY_KEYRING` is not set, it is also the
  privacy signing key, as the version `session-` followed by the first 20 hexadecimal characters of its
  SHA-256.
  - To rotate it, first set `VALO_PRIVACY_KEYRING`, keeping the current key under that version and
    adding a new current one ([privacy key rotation](privacy-key-rotation-checkpoint.md)). Then store a
    new `SESSION_SECRET` of at least 32 characters and restart.
  - What it changes: every limit's count starts again, and the signals' address hashes change. Once the
    keyring holds the old privacy key, no kept record depends on the secret.
  - Without the old privacy key, privacy processing holds, by design, until it is restored.
  - In an emergency, do the same at once.
- **`VALO_PRIVACY_KEYRING`** (the API and the worker): the current version and every version that
  signed a kept record.
  - To rotate, add a new version and make it current. Keep every earlier version: without one, the
    records it signed cannot be checked, and processing holds. A version's name is never reused.
  - In an emergency, make a new version current at once. The compromised version stays only to check
    what it signed, and when it was compromised is recorded.

- **The workspace credential key** is made by each API and worker process when it first needs it, held
  in that process alone, and replaced in the last day of its seven. The database keeps only what checks
  it (`valo_scope_keys`), and removes that a day after the key ends. There is nothing to rotate by
  hand: restarting the processes replaces it.

## Provider keys

- **`CLERK_SECRET_KEY`** (the API): the identity provider's backend key. To rotate, make a new key in
  the provider's dashboard, store it, restart the API, then delete the old key there. In an emergency,
  delete the old key first; until the new one is stored, what needs the provider's backend fails.
- **`PAYSTACK_SECRET_KEY`** (the API and the worker): the payment provider's test key; a live key is
  refused. To rotate, roll it in the provider's dashboard, store the new one and restart. In the legacy
  webhook mode it also checks the webhooks' signatures.
- **`PAYSTACK_WEBHOOK_SECRET`** (the API): a comma-separated list of `whsec_` secrets, any of which a
  webhook may be signed with, so it rotates with an overlap. Add the new secret to the list, restart,
  move the provider to it, then remove the old one. In an emergency, remove the old one at once:
  webhooks signed with it are refused until the provider signs with the new one.
- **`AI_INTEGRATIONS_OPENAI_API_KEY`**: provided and rotated by Replit's AI integrations. No AI call runs
  without the owner's approval.
- **`VALO_WORKER_MONITOR_URL`** and **`VALO_OPERATIONS_MONITOR_URL`** (the worker): the monitoring
  service's ping addresses. Whoever has one can report its check, so it is kept as a secret. To rotate,
  give the check a new ping address in the monitoring service, store it and restart the worker.
- **`VALO_EDITORIAL_LIFECYCLE_DATABASE_URL`** and **`VALO_EDITORIAL_LIFECYCLE_PUBLISHER_DATABASE_URL`**
  (development only): the editorial lifecycle seed database's connections. Rotate them on that server,
  as for the application's login and the publisher's.

## The operator's backup secrets

These are not in the settings registry; the backup cycle reads them ([scheduled
recovery](phase2-scheduled-recovery.md)).
- **`VALO_RESTIC_PASSWORD`**: encrypts the backup repository. Rotate it with restic's own commands,
  `restic key add` and then `restic key remove` for the old key, so the snapshots stay readable, and
  record who keeps the new one.
- **`AWS_ACCESS_KEY_ID`** and **`AWS_SECRET_ACCESS_KEY`**: the backup bucket's application key. Make a
  new key restricted to the bucket, store it, then delete the old one at the storage provider.
- **`VALO_BACKUP_MONITOR_URL`**: as the other ping addresses.
- **`VALO_RECOVERY_CONTROL_KEY_FILE`** is made afresh for each isolated recovery rehearsal and never
  kept.
