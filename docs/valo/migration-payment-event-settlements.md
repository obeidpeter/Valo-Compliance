# Applying the payment event settlement migrations to the development database

Two migrations let finance settle a Paystack event that Valo could not match or process, and keep each
settlement as it is ([reconciliation](../architecture/reconciliation.md), slice 3a). They need the payment
check guard migration (`20261127194345_payment_check_guard`) first, in the journal's order. Neither has been
applied to the Replit development database yet.

- **`20261127203546_payment_event_settlements`** adds one empty table, `valo_payment_event_settlements`: for
  each settled event and the finding it was settled with, who settled it and when. It adds its key on the
  event and the finding (`valo_payment_event_settlement_unique`) and its link to the event
  (`valo_payment_event_settlement_event_fk`).
- **`20261127203554_payment_event_settlement_guard`** adds one function and three triggers,
  `valo_payment_event_settlement_kept()`, `valo_payment_event_settlements_kept`,
  `valo_payment_event_settlements_no_truncate` and `valo_payment_event_settlements_digest`. A settlement is
  taken only of an event that needs review, with the finding it has, from finance, with its reason recorded
  in the staff access audit in the same transaction. A settlement is never changed or removed, and the table
  is never emptied. The settlements keep a history digest, as every history does
  ([audit trail](../architecture/audit-trail.md)), started from the rows the table holds.
- **They change no row and grant nothing.** A customer's request has no access to the new table. No other
  table changes: the events keep every row and column they have.

**Without them, the rest works as before**, except two readers of the new table:

- **The finance area's "Paystack events waiting for finance"** answers that it cannot be read.
- **The alert's reading of those events cannot be taken**, so the staff alert list shows
  `UNMATCHED_PAYMENT_EVENTS_PROBE_UNAVAILABLE` until they are applied.

The event worker names why it left an event for finance with or without them. Apply both migrations before
the code, or together with it.

**After them, a statement that writes a settlement by hand fails**, with "A payment event is settled only by
finance, with the reason recorded as it is settled", or "A payment event is settled only while it needs
review, with the finding it has". One that changes or removes a settlement fails with "A settlement of a
payment event is never changed or removed". Settle an event from the finance area instead.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the payment check guard and has neither of these yet:
   `SELECT to_regprocedure('public.valo_payment_check_kept()')` is not null, and
   `SELECT to_regclass('public.valo_payment_event_settlements')` is null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply each file inside a transaction of its own, in this order, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127203546_payment_event_settlements.sql
   ```

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261127203554_payment_event_settlement_guard.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM valo_payment_event_settlements` is 0.
   - `SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.valo_payment_event_settlements'::regclass
     AND NOT tgisinternal ORDER BY tgname` is `valo_payment_event_settlements_digest`,
     `valo_payment_event_settlements_kept` and `valo_payment_event_settlements_no_truncate`, each `O`.
   - `SELECT * FROM valo_history_digest_mismatches()` returns no row.
   - `SELECT has_function_privilege('public', 'public.valo_payment_event_settlement_kept()', 'EXECUTE')` is
     false.
   - `SELECT has_table_privilege('valo_workspace_scope', 'public.valo_payment_event_settlements', 'SELECT')`
     is false.
   - Where the database has an event that needs review, this is refused with "settled only by finance", and
     changes nothing:

     ```sql
     BEGIN;
     INSERT INTO valo_payment_event_settlements (id, event_id, finding, resolved_by, resolved_at)
     SELECT gen_random_uuid(), id, coalesce(failure, ''), 'synthetic-check', now()
     FROM valo_payment_events WHERE status = 'needs_review' LIMIT 1;
     ROLLBACK;
     ```

5. Record the target, commit, file hashes, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, roll the code back first. Then drop the triggers and the function, and then the table:
`DROP TRIGGER valo_payment_event_settlements_kept ON public.valo_payment_event_settlements; DROP TRIGGER
valo_payment_event_settlements_no_truncate ON public.valo_payment_event_settlements; DROP TRIGGER
valo_payment_event_settlements_digest ON public.valo_payment_event_settlements; DROP FUNCTION
public.valo_payment_event_settlement_kept();`, then `DROP TABLE public.valo_payment_event_settlements;`,
which removes every settlement finance has recorded. Their reasons stay in the staff access audit, and the
table's rows in `valo_history_digests` stay, unread.
