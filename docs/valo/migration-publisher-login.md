# Applying the publisher login migration to the development database

`20261121190325_publisher_login` gives the publisher a database login of its own
(decision 0017, point 6). It has not been applied to the Replit development database
yet.

- It creates one role, `valo_publisher_login`. The login cannot log in until step 4
  below enables it, cannot administer the database, may become only the existing
  publisher role (`valo_content_publisher_dev`) and holds nothing itself. If the role
  already exists with privileges it must not have, the migration refuses to continue.
- It adds one trigger on `valo_content_versions`. A version becomes `published` only
  in a database session that logged in as `valo_publisher_login`. Every other session
  is refused with `42501`, whatever role it has switched to, the application's own
  login included.
- Holding and withdrawing a version are unchanged. They take content away, and stay
  open to the application's login.
- No row is read or written.

Apply it, and enable the login, before running code that includes it. That code
releases a version on the publisher's own connection (`VALO_PUBLISHER_DATABASE_URL`),
so until both are done every release fails with `VALO_PUBLISHER_LOGIN_UNAVAILABLE`.
Nothing else is affected: preparing, reviewing, holding, withdrawing and reading
content do not use the login.

TPL-07's one-step path (`operational-release.ts`) pays for authoring and reviews and
then releases. It checks first that the publisher can log in, and stops before anything
is paid for when it cannot. The reviewed-pair command (`publish-reviewed-pair.ts`) pays
for nothing: if the login is unavailable it fails, and running it again once the login
works releases the same candidate.

The Replit development database has no Drizzle ledger. Follow the existing procedure
in [phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the prepared candidates migration (the table
   `valo_prepared_candidates` exists) and that `valo_publisher_login` does not exist.
   Confirm the application's role can create roles: the earlier roles were created the
   same way.
2. Pause the commands that publish. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction with
   `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'`.
4. Generate a password of at least 24 printable ASCII characters and store it in the
   secret store as `VALO_PUBLISHER_LOGIN_PASSWORD`. From the repository root, with the
   database's `DATABASE_URL`, run
   `node lib/db/scripts/publisher-login.mjs --print-url`. It enables the login with
   that password, sending the server only its SCRAM verifier, and prints the
   connection string. Store that in the secret store as `VALO_PUBLISHER_DATABASE_URL`.
   Give it only to the process that publishes: the operator commands
   `publish-reviewed-pair.ts` and the TPL-07 preparation. The API and the worker do not
   need it.
5. Check, connected with `DATABASE_URL`, that
   `SELECT count(*) FROM pg_trigger WHERE tgrelid='valo_content_versions'::regclass AND tgname='valo_version_publisher_login'`
   returns 1. Do not test the refusal by trying to publish a real version. Connected
   with `VALO_PUBLISHER_DATABASE_URL`, check that
   `SELECT count(*) FROM valo_content_versions` is refused with `permission denied`,
   and that
   `BEGIN; SET LOCAL ROLE valo_content_publisher_dev; SELECT count(*) FROM valo_content_versions; ROLLBACK;`
   counts the versions. Then deploy the code.

The publisher's connection must lead to the application's own database: the same host,
port and database as `DATABASE_URL`. The code refuses any other before connecting.

To change the login's password, repeat step 4 with the new password. Connections that
are already open keep working until they close.

The editorial lifecycle evaluation releases versions in a disposable copy of a local
seed database. For those cases, enable the login on the seed database's server in the
same way and store its connection string as
`VALO_EDITORIAL_LIFECYCLE_PUBLISHER_DATABASE_URL`. Without it, a lifecycle case that
releases a version reports the publisher login as unavailable.

To undo it, roll the code back first. Then drop the trigger
`valo_version_publisher_login` and the function
`valo_publication_needs_publisher_login`, revoke `valo_content_publisher_dev` from
`valo_publisher_login` and drop the login. Remove `VALO_PUBLISHER_DATABASE_URL` and
`VALO_PUBLISHER_LOGIN_PASSWORD` from the secret store. Code from before this migration
publishes on the application's connection, so it works again once the trigger is gone.

Never run the full migrator against this database and never write ledger rows.
`lib/db/scripts/phase1-migrations.test.mjs` checks the upgrade on tracked and
unjournalled databases: that an interrupted migration leaves no login behind, that the
login is created unable to log in and may become only the publisher role, that the
cluster's own login cannot publish a candidate as itself or as the publisher role, and
that a session logged in as the publisher can. The database job's
`publication-guards` test checks the same against the application's real connections,
and that the release itself runs on the publisher's connection.
