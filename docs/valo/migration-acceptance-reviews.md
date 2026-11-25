# Applying the acceptance reviews migration to the development database

`20261125191813_acceptance_reviews` adds the reviewer role and the record of an independent reviewer's
decisions on the acceptance cases ([the reviewer's record](../architecture/reviewer-record.md), slice 1,
decision 0016, for EDP-010, RUL-008 and AI-008). It needs the source review preparations migration
(`20261125183409_source_review_preparations`) first. It has not been applied to the Replit development
database yet.

- It adds `reviewer` to the staff roles (`valo_staff_assignments_role_check`).
- It adds `valo_acceptance_reviews`: one row per decision, with the corpus, the case's id and hash, the
  kind of judgment, the answer, why, the reviewer's staff identity and the time. Its guard,
  `valo_guard_acceptance_review()`:
  - takes a row only from an active reviewer, and dates it itself;
  - never changes or removes a row, and `valo_acceptance_reviews_no_truncate` refuses a truncate.
- An expected outcome is confirmed or rejected and names no run. A run outcome is met or not met, and
  names its run and the hash of its results (`valo_acceptance_reviews_judgment`).
- `valo_guard_reviewer_independence()` refuses an active reviewer assignment for someone with an active
  content assignment, and the reverse, an emergency grant included while it lasts. Two such grants to one
  person at once are taken one after the other, so both cannot pass.
- It changes no row and no grant. The scoped role gets nothing on the new table.

Until the migration is applied, the acceptance cases page answers "Apply the acceptance review migration
before recording decisions.", and the staff roles screen cannot grant the reviewer role.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the source review preparations migration (there is a
   `valo_source_review_preparations` table), and that there is no `valo_acceptance_reviews` table.
2. Check that no one holds both of the roles the migration makes exclusive. There is no reviewer role yet,
   so this returns 0:

   ```sql
   SELECT count(*) FROM valo_staff_assignments WHERE role = 'reviewer';
   ```

3. Pause writes and the worker. Take a fresh encrypted backup.
4. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125191813_acceptance_reviews.sql
   ```

5. Check that these return what follows:
   - `SELECT count(*) FROM valo_acceptance_reviews` is 0.
   - `SELECT count(*) FROM pg_trigger WHERE tgname IN ('valo_guard_acceptance_review', 'valo_acceptance_reviews_no_truncate', 'valo_guard_reviewer_independence')` is 3.
   - `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'valo_staff_assignments_role_check'`
     lists `reviewer`.
6. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

**Granting the role.** The owner names the reviewer (decision 0016, point 1). A system administrator then
grants the role on the staff roles screen, as any other role, never their own. A person who holds the
content role is refused until it is revoked.

To roll back, before any decision is recorded and while no one holds the reviewer role: drop the triggers
`valo_guard_reviewer_independence`, `valo_acceptance_reviews_no_truncate` and
`valo_guard_acceptance_review`, the functions `valo_guard_reviewer_independence()` and
`valo_guard_acceptance_review()` and the table `valo_acceptance_reviews`, and restore the role check
without `reviewer`. Once a decision exists, keep it: dropping it would lose who decided what about which
case.
