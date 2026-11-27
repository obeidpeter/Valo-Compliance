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
- pausing messages on the staff screen still sets the pause, and counts none waiting.

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
