# Applying the drafter login migration to the development database

`20261126151429_drafter_login` gives drafting a database login of its own
([service logins](../architecture/service-logins.md), part 1; SEC-006). It has not been applied to the
Replit development database yet.

- It creates one role, `valo_drafter_login`. The login cannot log in until step 4 below enables it,
  cannot administer the database, may become only the existing drafter role
  (`valo_content_drafter_dev`) and holds nothing itself. If the role already exists with privileges it
  must not have, the migration refuses to continue.
- It adds one trigger on `valo_content_versions` and one on `valo_prepared_candidates`. A content
  version, or a prepared candidate's record, is added only in a database session that logged in as
  `valo_drafter_login`. Every other session is refused with `42501`, whatever role it has switched to,
  the application's own login included.
- Holding, withdrawing, publishing and reading content are unchanged.
- No row is read or written.

Apply it, and enable the login, before running code that includes it. That code adds content on
drafting's own connection (`VALO_DRAFTER_DATABASE_URL`), so until both are done every preparation
fails with `VALO_DRAFTER_LOGIN_UNAVAILABLE`. Each preparation asks first whether drafting can log in,
so it stops before it reads, renders, saves or pays for anything. The worker's preparation job records
`VALO_DRAFTER_LOGIN_UNAVAILABLE` on the request it could not prepare. Nothing else is affected: the
staff library, reviews, the publisher and reading content do not use the login.

The Replit development database has no Drizzle ledger. Follow the existing procedure
in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the security signal limits and input migration (the check
   `valo_security_signals_kind_check` lists `refused_input`) and that `valo_drafter_login` does not
   exist. Confirm the application's role can create roles: the earlier roles were created the same way.
2. Pause the commands that prepare and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
4. Generate a password of at least 24 printable ASCII characters and store it in the secret store as
   `VALO_DRAFTER_LOGIN_PASSWORD`. From the repository root, with the database's `DATABASE_URL`, run
   `node lib/db/scripts/drafter-login.mjs --print-url`. It enables the login with that password,
   sending the server only its SCRAM verifier, and prints the connection string. Store that in the
   secret store as `VALO_DRAFTER_DATABASE_URL`. Give it only to what drafts: the operator commands that
   prepare a candidate (`prepare-finite-operational-set.ts`, the preparation steps of
   `finite-inference-run.ts`, and TPL-07's one-step `operational-release.ts` and
   `chatgpt-permission-proof.ts`), the reviewed-pair command (`publish-reviewed-pair.ts`), which saves
   the reviewed version, and the worker, whose preparation job prepares a candidate from review work. The API does not need it. On a self-hosted machine the
   supervisor (`scripts/ops/runtime_host.py`) gives it to the worker alone. Replit's secrets reach every
   workflow, the API's included; no API code names the connection (repository rule
   `drafter-connection`).
5. Check, connected with `DATABASE_URL`, that
   `SELECT count(*) FROM pg_trigger WHERE tgname IN ('valo_version_requires_drafter_login','valo_prepared_candidate_requires_drafter_login')`
   returns 2. Do not test the refusal by adding a real version. Connected with
   `VALO_DRAFTER_DATABASE_URL`, check that `SELECT count(*) FROM valo_content_versions` is refused with
   `permission denied`, and that
   `BEGIN; SET LOCAL ROLE valo_content_drafter_dev; SELECT count(*) FROM valo_content_versions; ROLLBACK;`
   counts the versions. Then deploy the code and start the worker again.

Drafting's connection must lead to the application's own database: the same host, port and database as
`DATABASE_URL`. The code refuses any other before connecting.

To change the login's password, repeat step 4 with the new password. Connections that are already open
keep working until they close.

To undo it, roll the code back first. Then drop the triggers `valo_version_requires_drafter_login` and
`valo_prepared_candidate_requires_drafter_login` and the function `valo_content_needs_drafter_login`,
revoke `valo_content_drafter_dev` from `valo_drafter_login` and drop the login. Remove
`VALO_DRAFTER_DATABASE_URL` and `VALO_DRAFTER_LOGIN_PASSWORD` from the secret store. Code from before
this migration adds content on the application's connection, so it works again once the triggers are
gone.

Never run the full migrator against this database and never write ledger rows.
`lib/db/scripts/phase1-migrations.test.mjs` checks the upgrade on tracked and unjournalled databases:
that an interrupted migration leaves no login behind and keeps every row, that the login is created
unable to log in and may become only the drafter role, that the cluster's own login can no longer add a
version or a prepared candidate as itself or as the drafter role, that a session logged in as the
drafting login can, as the drafter role only, and that holding a version stays open to the
application's login. The database job's `publication-guards` test checks the same against the
application's real connections.
