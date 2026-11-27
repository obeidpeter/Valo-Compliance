# Applying the manual reviews migration to the development database

`20261125122001_manual_reviews` gives every staff-library entry other than a regulatory guide a review
date, and holds an entry overdue for its review from new use
([keeping published guidance current](../architecture/guidance-currency.md), slice 2). It needs the manual
regulatory words migration (`20261125112436_manual_regulatory_words`) first. It has not been applied to
the Replit development database yet.

- It adds one table, `valo_manual_reviews`: a Content editor's review of a published entry, with its note
  of 20 to 1,000 characters. Its trigger, `valo_guard_manual_review()`, accepts a review only of the
  published version of an entry other than a regulatory guide, from an active Content editor, dates it
  when it is recorded, and refuses any change or removal.
- It adds one function, `valo_manual_review_due(uuid)`: when an entry is next due for review, 90 days
  after it was published or last reviewed.
- It replaces three functions so that an overdue entry is not listed to save, copied into a new document
  or started as a form: `valo_live_manual_templates()`, `valo_free_library_edition(uuid)` and
  `valo_free_form_edition(text)`. Their grants stay as they were.
- It drops `valo_live_manual_premium_versions(uuid)` and creates it again with a second column, `held`:
  whether each published premium edition is overdue for its review. The offers, a new order and the price
  command leave out a held edition, while its buyers still download it and find it among their purchases.
  It is granted to the workspace role again, as before.
- A buyer's purchased file and documents already made are unchanged.
- It changes no existing row. An entry already published is due 90 days after its publication.

**The application code depends on this migration** for the staff library's review dates and its review
action: until it is applied, the list shows no review dates and recording a review fails. The public
library and the free downloads read the review dates only where the function exists, and otherwise show
every published entry, as before. The premium offers read `held` only where the function gives it, and
otherwise offer every published edition, as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the manual regulatory words migration: the column
   `valo_manual_regulatory_checks.words_sha256` exists, and the table `valo_manual_reviews` does not.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125122001_manual_reviews.sql
   ```

4. Check that these return what follows:
   - `SELECT count(*) FROM pg_trigger WHERE tgname = 'valo_guard_manual_review'` is 1.
   - `SELECT has_function_privilege('valo_workspace_scope', 'public.valo_live_manual_templates()', 'EXECUTE')`
     is true, and so is the same check of `public.valo_live_manual_premium_versions(uuid)`.
   - `SELECT has_function_privilege('public', 'public.valo_live_manual_premium_versions(uuid)', 'EXECUTE')`
     is false.
   - `SELECT count(*) FROM valo_manual_library WHERE state = 'published' AND kind <> 'regulatory_article' AND public.valo_manual_review_due(id) <= now()`
     is the number of entries already overdue: each was published more than 90 days ago. Review each
     before resuming writes, or it stays held from new use.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back:
1. Recreate `valo_live_manual_templates()` and `valo_free_library_edition(uuid)` from
   `20261125000142_library_saves_and_copies.sql`, and `valo_free_form_edition(text)` from
   `20261124175837_document_forms.sql`.
2. Drop `valo_live_manual_premium_versions(uuid)` and create it again from its `CREATE FUNCTION` statement
   in `20261122183800_manual_premium_templates.sql`. Revoke it from `PUBLIC` and grant it to
   `valo_workspace_scope`, as that file does.
3. Drop the trigger, its function, the due-date function and the table. The reviews are lost with the
   table.
