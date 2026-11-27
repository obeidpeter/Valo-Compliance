# Applying the messages migrations to the development database

`20261126214151_messages` and `20261126214201_message_grants` add the outbox every message Valo means to
send waits in ([messages](../architecture/messages.md), slice 1a). They need the history digest change
triggers migration (`20261126174600_history_digest_change_triggers`) first, in the journal's order. They
have not been applied to the Replit development database yet. Apply both, in order.

- **The first** adds `valo_messages`, empty, with row-level security that limits a customer request to its
  own workspace's rows. Each row names its workspace, its kind and class, whose verified address it is
  for and the record it is about, with its state: its status, attempts, lease, next attempt, and the
  sender's name and reference once a sender took it. It keeps no message text and no address.
  - A workspace's record owes one message of each kind (`valo_message_once`).
  - Only the kinds there are, each with its class, and only the states there are
    (`valo_message_shape`).
  - A state agrees with itself: a lease only while sending, a sender and its reference once accepted,
    and an attempt's times with the attempt (`valo_message_state`).
- **The second** lets customer requests add a message their own action owes, read their own workspace's,
  and change only a message's state. They cannot change whom or what a message is for, or remove one.
- Neither changes a row.

**Without these migrations, everything else works as before, and no message is owed.** The code looks for
the table first:
- a payment still settles and a refund is still processed, with the purchase ledger's row that a message
  is owed, as today. No message is recorded for it, and none is sent for it later;
- the worker's `messages` task finds nothing to do;
- a workspace's data download lists no messages, and an erasure has none to remove;
- pausing messages on the staff screen still sets the pause, and counts none waiting;
- the workspace's Messages page lists no message, and each receipt on the purchases screen says that
  nothing was emailed about it;
- the two readings of messages, waiting and failed, cannot be taken, so the alert list shows
  `MESSAGES_PROBE_UNAVAILABLE` and `FAILED_MESSAGES_PROBE_UNAVAILABLE` until the migrations are applied.

**No message reaches anyone.** The only sender is a stand-in that sends nothing, and it is off unless
`VALO_MESSAGE_SENDER=stand-in` is set for the worker. Unset, each message waits as `held`, with the reason
`SENDER_NOT_CONFIGURED`. A real sender waits for the owner's approval of a provider and a sender address.

**The worker gains a scheduled task, `messages`.** Each minute it offers each due message to the
configured sender. A database whose worker schedules were set up before this change gets the new task
when the reviewed queue setup is run again:

```sh
VALO_DEV_QUEUE_MIGRATION=reviewed-synthetic-development pnpm --filter @workspace/api-server queue:apply-development
```

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the history digest change triggers migration:
   `SELECT to_regclass('public.valo_history_digest_changes')` is not null, and
   `SELECT to_regclass('public.valo_messages')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126214151_messages.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261126214201_message_grants.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_messages` is 0.
   - `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.valo_messages'::regclass` is true.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_messages', 'INSERT')` is true, and the same
     for `DELETE` is false.
   - `SELECT has_column_privilege('valo_workspace_scope', 'valo_messages', 'status', 'UPDATE')` is true, and
     the same for `recipient_identity_id` is false.
5. Run the reviewed queue setup again, as above, so the worker's `messages` task is scheduled.
6. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back before any message is recorded, drop the table `valo_messages`, which drops its policy and
grants. Once a message is recorded, keep the table: it is the record of what Valo owed each workspace and
what became of it.

## The delivery reports (slice 2a)

`20261127001808_message_deliveries` and `20261127001815_message_delivery_grants` add what the email
provider reports about a message it took ([messages](../architecture/messages.md), part 3). They need the
two migrations above first. They have not been applied to the Replit development database yet. Apply
both, in order.

- **The first** adds two empty tables and two indexes.
  - `valo_email_events` holds each signed report until the worker records it: the provider, its own id
    for the report, what the report says, the provider's reference for the message, and the report's
    time. It names no workspace and holds no address, subject or text. A report delivered twice is one
    row (`valo_email_event_once`), and a row's state agrees with itself (`valo_email_event_shape`).
  - `valo_message_deliveries` holds the latest report about each message or reminder of a workspace, one
    row for each record (`valo_message_delivery_once`), with row-level security that limits a customer
    request to its own workspace's rows.
  - `valo_message_provider_idx` and `valo_reminder_provider_idx` find a message or a reminder by the
    provider's reference.
- **The second** lets customer requests read their own workspace's reports, and lets the worker's task
  record one in that workspace's scope. Customer requests have no access to `valo_email_events`.
- Neither changes a row.

**Without these migrations, everything else works as before, and no report is taken or shown.** The code
looks for the tables first:
- `POST /api/webhooks/email` answers that it is not set up, so the provider sends the report again later;
- the worker's `messages` task offers messages as before, and records no report;
- the Messages page, the reminders and the purchases screen list as before, with no report on any row;
- a workspace's data download lists no reports, and an erasure has none to remove.

**No report arrives unless the owner sets it up.** The webhook is off unless
`VALO_EMAIL_WEBHOOK_SECRET` holds the provider's signing secret, and the provider sends nothing until the
webhook's address is entered there. Both are the owner's to do (the design's point 1). Only the
reminders' development mailer sends through the provider, to one test address, so only a reminder can have
a report.

1. Confirm the database is at the message grants migration:
   `SELECT to_regclass('public.valo_messages')` is not null, and
   `SELECT to_regclass('public.valo_message_deliveries')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127001808_message_deliveries.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127001815_message_delivery_grants.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_email_events` and `SELECT count(*) FROM valo_message_deliveries` are 0.
   - `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.valo_message_deliveries'::regclass` is true.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_message_deliveries', 'UPDATE')` is true, and
     the same for `DELETE` is false.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_email_events', 'SELECT')` is false.
5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

The worker's `messages` task is the one already scheduled: the queue setup need not be run again for
this.

To roll back before any report is recorded, drop the two tables and the two indexes. Once a report is
recorded, keep `valo_message_deliveries`: it is the record of what the email provider said about a
workspace's messages.

## Suppression (slice 2b)

`20261127005802_email_suppressions` and `20261127005804_email_suppression_check` let Valo stop sending
optional messages to an address whose email service sent one back for good, or where one was marked as
spam ([messages](../architecture/messages.md), part 3). They need the two delivery migrations above
first. They have not been applied to the Replit development database yet. Apply both, in order, in one
sitting.

- **The first** adds an empty table, two indexes, and two columns and a check to `valo_email_events`.
  - `valo_email_suppressions` holds one row for each suppressed address: a keyed checksum of the address
    and the version of the key it was made under, why, the first and last reports' times, and when it
    ends. It holds no address, and names no person and no workspace. An address is there once under a key
    (`valo_email_suppression_once`), and a row agrees with itself (`valo_email_suppression_shape`).
    `valo_email_suppression_expiry_idx` finds the rows whose time has passed.
  - `valo_email_events` gains `address_hash` and `address_key_version`, both empty on every row there
    is. A report keeps them only together, only as a checksum, and only for a bounce or a complaint
    (`valo_email_event_address`).
- **The second** adds one function, `valo_email_address_suppressed`. It answers only yes or no, for
  checksums the caller already holds, and it is the only access customer requests and the worker's
  per-workspace jobs have to the list. No other role may call it.
- Neither changes a row.

**Without the first, no report is taken, no address is suppressed, and reminders go on as before.** The
code looks for the table first:
- `POST /api/webhooks/email` answers that it is not set up, so the provider sends the report again later;
- the worker's `messages` task offers messages as before, and records no report. One that was already
  waiting stays waiting, and is recorded once the table is there;
- what was recorded before still shows on the Messages page, the reminders and the purchases screen;
- a reminder's mailer finds no address suppressed, and sends as before.

**With the first and not the second, no reminder is sent.** Reports are taken and addresses suppressed,
but the mailer cannot ask whether an address is suppressed, and sends nothing when it cannot ask. Each
try is recorded as not confirmed, and after five the reminder stops. So apply both in one sitting.

1. Confirm the database is at the message delivery grants migration:
   `SELECT to_regclass('public.valo_message_deliveries')` is not null, and
   `SELECT to_regclass('public.valo_email_suppressions')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127005802_email_suppressions.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127005804_email_suppression_check.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_email_suppressions` is 0.
   - `SELECT count(*) FROM valo_email_events WHERE address_hash IS NOT NULL` is 0.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_email_suppressions', 'SELECT')` is false.
   - `SELECT has_function_privilege('valo_workspace_scope', 'valo_email_address_suppressed(text[], text[])', 'EXECUTE')`
     is true.
   - `SELECT valo_email_address_suppressed(ARRAY[]::text[], ARRAY[]::text[])` is false.
5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

The worker's `messages` task is the one already scheduled: the queue setup need not be run again for
this.

**The key.** A checksum is made under the privacy keyring's current key (`VALO_PRIVACY_KEYRING`, or the
key derived from `SESSION_SECRET` where no keyring is set). Replacing the key keeps the earlier
suppressions only while the keyring still holds the earlier key. Drop a key from the keyring, or change
`SESSION_SECRET` with no keyring, and every suppression made under it stops counting: those addresses are
tried again.

To roll back before any address is suppressed, drop the function, the table, and the two columns with
their check. Once an address is suppressed, keep the table: without it that address is emailed again.

## Unsubscribe (slice 3a)

There is no migration. The unsubscribe link uses tables the database already has, and the access
customer requests already hold: the reminder setting, the consent history, the reminders, the
workspace's history and the limit counters.

**The key.** A link is signed under a key made from the privacy keyring's current key
(`VALO_PRIVACY_KEYRING`, or the key derived from `SESSION_SECRET` where no keyring is set). Drop a key
from the keyring, or change `SESSION_SECRET` with no keyring, and every link made under it stops
working. Its page then says that the link does not work, and where reminders are turned off in Valo.

## Notices by email (slice 5)

`20261127033059_notice_digests` and `20261127033114_notice_digest_grants` add the days whose notices owe
a workspace a message ([messages](../architecture/messages.md), part 7). They follow the suppression
migrations in the journal's order. They have not been applied to the Replit development database yet.
Apply both, in order, in one sitting.

- **The first** adds an empty table and lets a message be about a day's notices.
  - `valo_notice_digests` holds one row for a workspace and a Lagos day (`valo_notice_digest_once`), and
    only for a day that has ended (`valo_notice_digest_day_ended`). It holds nothing of the notices. Row-level
    security limits a customer request to its own workspace's rows.
  - `valo_message_shape` is replaced by the same rule with one kind more, `notices_digest`, as a necessary
    message. Every message there is already meets it.
- **The second** lets customer requests read their own workspace's days. They write none: the worker
  records them on the application's own connection.
- Neither changes a row.

**Without the first, everything else works as before, and no notice is emailed.** The code looks for the
table first:
- the worker's `messages` task records no day, and offers messages and records reports as before;
- notices show on the Workspace page as before;
- a workspace's data download lists no days, and an erasure has none to remove.

**With the first and not the second, a day's message cannot be made.** The task records the day and
queues its message. The dispatcher then reads the day in the workspace's scope, which may not read the
table yet: each try fails, the task reports a failure each minute, and the Messages page of a workspace
that is owed such a message answers with an error. So apply both in one sitting.

**The first run catches up a week.** Once both are applied, the task records a day for each workspace
with a correction, a changed requirement or a withdrawn template in the last seven days, one message for
each day. No message reaches anyone: with no sender set each waits as `held`, and with the stand-in each
is recorded as not emailed.

1. Confirm the database is at the suppression check migration:
   `SELECT to_regprocedure('valo_email_address_suppressed(text[], text[])')` is not null, and
   `SELECT to_regclass('public.valo_notice_digests')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file on its own inside a transaction, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127033059_notice_digests.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127033114_notice_digest_grants.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_notice_digests` is 0.
   - `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.valo_notice_digests'::regclass` is true.
   - `SELECT has_table_privilege('valo_workspace_scope', 'valo_notice_digests', 'SELECT')` is true, and the
     same for `INSERT` is false.
   - `SELECT pg_get_constraintdef(oid) LIKE '%notices_digest%' FROM pg_constraint WHERE conname = 'valo_message_shape'`
     is true.
5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

The worker's `messages` task is the one already scheduled: the queue setup need not be run again for
this.

To roll back before any day is recorded, drop the table `valo_notice_digests`, which drops its policy and
grant, and put `valo_message_shape` back as the messages migration made it. Once a day is recorded, keep
the table: its rows are what the messages about those days are about.
