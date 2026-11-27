# Applying the rule sign-off migration to the development database

`20261123184636_rule_owner_signoffs` prepares requirements-checker rules to be released on the
development owner's sign-off (decision 0020). It has not been applied to the Replit development
database yet.

- It adds `valo_rule_owner_signoffs`, a sign-off of one rule version that is never changed or
  removed (`valo_rule_owner_signoff_immutable`, `valo_rule_owner_signoff_no_truncate`).
- It adds `valo_guard_owner_signed_rule` on `valo_rule_releases`. An owner-signed release is refused
  unless a sign-off of its exact manifest was made in the same transaction, by the designated
  development owner (`valo_manual_regulatory_owner`), on a source check under a day old, confirming
  EDP-005's enhanced checks for any risk but `general`. An owner-signed release then changes only
  its status and is never deleted. It leaves publication once, superseded or withdrawn, and is never
  published again: that takes a new version and a new sign-off.
- Releases on the reviewed route are unchanged, and it reads and changes no existing row.

**The application code depends on this migration only for owner-signed rules.** Four rules are
prepared for the sign-off panel (Staff → System, "Requirements check: rule sign-off"), and none is
released until the owner signs it there.
Until the migration is applied, signing a rule fails because its sign-off table is missing; the
checker, the panel's list and the reviewed route work as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the industry pack migration (`valo_manual_one_pack` exists) and that
   `valo_rule_owner_signoffs` does not exist.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261123184636_rule_owner_signoffs.sql
   ```

4. Check that `SELECT to_regclass('public.valo_rule_owner_signoffs')` names the table, and that
   `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.valo_rule_releases'::regclass AND NOT tgisinternal`
   lists `valo_guard_owner_signed_rule`.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back before any rule is signed, drop the trigger `valo_guard_owner_signed_rule`, the
functions `valo_guard_owner_signed_rule` and `valo_rule_owner_signoff_immutable`, and the table
`valo_rule_owner_signoffs`.
