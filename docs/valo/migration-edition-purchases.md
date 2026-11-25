# Applying the edition purchases migration to the development database

`20261125010627_edition_purchases` lets a purchase carry to the next edition of the same template at
no further charge ([editions](../architecture/editions.md), slice 2; the finishing plan's delegated
decision 3). It has not been applied to the Replit development database yet.

- It replaces three functions that run as the staff library table's owner, keeping their owner and
  grants: `valo_manual_purchased_file(uuid)`, `valo_workspace_holds_template(text, text)` and
  `valo_premium_form_edition(text)`. Each now reads an active, verified purchase of any edition of
  the same template. Each still reads only an edition that is released now, so the edition bought
  closes to new downloads once it is replaced or withdrawn, as before.
- It replaces the guard on a premium form document, `valo_guard_document_form()`, so that a document
  started from a template's released edition may record the order for an earlier edition of the same
  template. A document still records the order once, and never changes it.
- It adds one function, `valo_workspace_carried_editions()`, that gives the scoped workspace each
  edition it bought that was replaced, with the released edition its purchase carries to. Only the
  scoped role may call it, and it returns nothing outside a workspace's scope.
- It changes no table, row or grant.

**The application code depends on this migration for the purchases screen and the template page.**
Both read the carried editions. Until it is applied, the purchases screen and the list of editions a
workspace owns fail with a database error for a workspace with a purchase whose edition is no longer
released, and a purchase does not carry to a new edition.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the document editions migration (the function
   `valo_workspace_document_editions` exists), and that `valo_workspace_carried_editions` does not.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261125010627_edition_purchases.sql
   ```

4. Check that `SELECT pg_get_functiondef('valo_manual_purchased_file(uuid)'::regprocedure) LIKE '%b.item_id%'`
   is true, and that `SELECT has_function_privilege('valo_workspace_scope', 'valo_workspace_carried_editions()', 'EXECUTE')`
   is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, drop `valo_workspace_carried_editions()`, and restore the three functions from
`20261122183800_manual_premium_templates.sql`, `20261124163621_form_template_purchases.sql` and
`20261124203124_premium_form_documents.sql`, and the guard from the last of these. A premium form
document recorded under an earlier edition's order stays as it is: the guard checks a document only
when it is written.
