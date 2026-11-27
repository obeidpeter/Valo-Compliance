# Applying the reviewer login migration to the development database

`20261126160415_reviewer_login` gives AI review a database login of its own
([service logins](../architecture/service-logins.md), part 2; SEC-006). It has not been applied to the
Replit development database yet. Apply the [drafter login migration](migration-drafter-login.md) first.

- It creates one role, `valo_reviewer_login`. The login cannot log in until step 4 below enables it,
  cannot administer the database, may become only the existing reviewer role
  (`valo_content_reviewer_dev`) and holds nothing itself. If the role already exists with privileges it
  must not have, the migration refuses to continue.
- It gives the reviewer role what recording an AI review's attempt needs on
  `valo_publication_ai_attempts`: reading the attempts, adding one, and recording how it went. It gives
  the drafter role reading the attempts and adding a drafting attempt.
- It adds one trigger that records and updates a review's attempt (`factual` or `challenge`) only in a
  database session that logged in as `valo_reviewer_login`, and a drafting attempt (`draft`) only in one
  that logged in as `valo_drafter_login`. Every other session is refused with `42501`, whatever role it
  has switched to, the application's own login included. The same trigger keeps each attempt's role
  and refuses any removal.
- The table cannot be emptied, and it keeps a history digest (ADM-009): the migration starts the digest
  from the attempts the table holds, in the same transaction.
- No attempt is changed or removed.

Apply it, and enable the login, before running code that includes it. That code records a review's
attempt on review's own connection (`VALO_REVIEWER_DATABASE_URL`), so until both are done every AI
review stops with `VALO_REVIEWER_LOGIN_UNAVAILABLE` before it reserves an attempt or calls a model.
TPL-07's one-step commands ask first whether review can log in, before they draft or pay for anything,
and the finite run asks before the dispatcher records anything for the pair. Nothing else is affected:
the API, the worker, preparing a candidate, publishing and reading content do not use the login.

The Replit development database has no Drizzle ledger. Follow the existing procedure
in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the drafter login migration (the trigger
   `valo_version_requires_drafter_login` exists) and that `valo_reviewer_login` does not exist. Confirm
   the application's role can create roles: the earlier roles were created the same way.
2. Pause the operator commands that run reviews. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
4. Generate a password of at least 24 printable ASCII characters and store it in the secret store as
   `VALO_REVIEWER_LOGIN_PASSWORD`. From the repository root, with the database's `DATABASE_URL`, run
   `node lib/db/scripts/reviewer-login.mjs --print-url`. It enables the login with that password,
   sending the server only its SCRAM verifier, and prints the connection string. Store that in the
   secret store as `VALO_REVIEWER_DATABASE_URL`. Give it only to the operator commands that run AI
   reviews: the finite run's reviewed pair (`finite-inference-run.ts`) and TPL-07's one-step
   `operational-release.ts` and `chatgpt-permission-proof.ts`. The API and the worker do not need it. On a
   self-hosted machine the supervisor (`scripts/ops/runtime_host.py`) gives it to neither. Replit's
   secrets reach every workflow, the API's included; no API code names the connection (repository rule
   `reviewer-connection`).
5. Check, connected with `DATABASE_URL`, that
   `SELECT count(*) FROM pg_trigger WHERE tgname IN ('valo_ai_attempt_requires_its_login','valo_publication_ai_attempts_no_truncate','valo_publication_ai_attempts_digest')`
   returns 3, and that `SELECT * FROM valo_history_digest_mismatches()` inside
   `BEGIN ISOLATION LEVEL REPEATABLE READ; … ROLLBACK;` returns no row. Do not test the refusal by adding
   a real attempt. Connected with `VALO_REVIEWER_DATABASE_URL`, check that
   `SELECT count(*) FROM valo_publication_ai_attempts` is refused with `permission denied`, and that
   `BEGIN; SET LOCAL ROLE valo_content_reviewer_dev; SELECT count(*) FROM valo_publication_ai_attempts; ROLLBACK;`
   counts the attempts. Then deploy the code.

Review's connection must lead to the application's own database: the same host, port and database as
`DATABASE_URL`. The code refuses any other before connecting.

To change the login's password, repeat step 4 with the new password. Connections that are already open
keep working until they close.

To undo it, roll the code back first. Then drop the trigger `valo_ai_attempt_requires_its_login` and the
function `valo_ai_attempt_needs_its_login`, revoke the grants the migration made on
`valo_publication_ai_attempts` and its id sequence from `valo_content_reviewer_dev` and
`valo_content_drafter_dev`, revoke `valo_content_reviewer_dev` from `valo_reviewer_login` and drop the
login. Remove `VALO_REVIEWER_DATABASE_URL` and `VALO_REVIEWER_LOGIN_PASSWORD` from the secret store. Code
from before this migration records attempts on the application's connection, so it works again once the
trigger is gone. Keep the truncate guard and the digest: the attempts stay a record of AI use, and code
from before this migration never removes one.

Never run the full migrator against this database and never write ledger rows.
`lib/db/scripts/phase1-migrations.test.mjs` checks the upgrade on tracked and unjournalled databases:
that an interrupted migration leaves no login behind and keeps every attempt, that the digest starts from
the attempts already held and matches, that the login is created unable to log in and may become only the
reviewer role, that the cluster's own login can no longer record, change or remove an attempt, as itself
or as either service's role, or empty the table, and that a session logged in as the review login records
a review's attempt and how it went, and one logged in as the drafting login a drafting attempt, each as its
own role only. The database job's `publication-guards` test checks the same against the application's
real connections.
