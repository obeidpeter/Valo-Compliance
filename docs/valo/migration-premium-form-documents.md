# Applying the premium form document migration to the development database

`20261124203124_premium_form_documents` lets a document start from a premium template's form
([forms v2](../architecture/forms-v2.md), slice 6), under the workspace's own purchase of that
edition. It has not been applied to the Replit development database yet, and it needs the document
form migration ([migration-document-forms.md](migration-document-forms.md)) applied first.

- It adds one column to `valo_documents`, empty for every existing document: `form_order`, the
  workspace's own order a premium form was started under. A foreign key ties it to an order of the
  same workspace (`valo_document_form_order_tenant_fk`), and a check allows it only on a document
  with a form record (`valo_document_form_order`).
- It replaces the body of the trigger function `valo_guard_document_form`. A free edition is still
  accepted only without an order. A published premium edition is now accepted too, with the order
  only when that order is a verified purchase of that exact edition, with the evidence a purchased
  file's download requires: an active entitlement, a verified order with its provider transaction,
  and the order's own edition and licence under an approved price. The record, the order with it,
  still never changes afterwards.
- A new function, `valo_premium_form_edition(title)`, answers for the workspace a transaction is
  scoped to and for nothing else: the most recently released premium edition of a template, by its
  registered title, that has form text and that the workspace bought, with the order it was bought
  under. Only the scoped role `valo_workspace_scope` may call it.
- It changes no existing row, grant or role.

**The application code depends on this migration for every document route.** The documents list,
the editor and saving read the new column. Until it is applied, those routes fail because the column
is missing.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the document form migration (`valo_documents` has a `form_edition`
   column) and that `valo_documents` has no `form_order` column.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261124203124_premium_form_documents.sql
   ```

4. Check that `SELECT count(*) FROM valo_documents WHERE form_order IS NOT NULL` is 0, that
   `SELECT to_regprocedure('public.valo_premium_form_edition(text)')` names the function, and that
   `SELECT has_function_privilege('valo_workspace_scope', 'public.valo_premium_form_edition(text)', 'EXECUTE')`
   is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, before any premium form document is started: drop the function
`valo_premium_form_edition`, restore the trigger function's body from
`20261124175837_document_forms.sql`, and drop the constraints `valo_document_form_order` and
`valo_document_form_order_tenant_fk` and the column `form_order`. Once a document records the order
it was started under, keep them: dropping them would lose which purchase a customer's document
belongs to.
