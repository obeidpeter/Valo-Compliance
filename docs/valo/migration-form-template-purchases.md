# Applying the form purchase migration to the development database

`20261124163621_form_template_purchases` lets the server ask whether a workspace has bought a
template, for the first slice of [forms v2](../architecture/forms-v2.md). It has not been applied to
the Replit development database yet.

- It adds one function, `valo_workspace_holds_template(template, title)`. The function answers, for
  the workspace the transaction is scoped to and for no other, whether that workspace holds a verified
  purchase of a live edition of the template:
  - a staff-library premium edition with the template's registered title, or a reviewed edition with
    its template id;
  - with the evidence a premium file's download already needs: an active entitlement, a verified
    order with its provider transaction, and the order's own edition and licence under an approved
    price.
- It returns a yes or a no and nothing else. Only the scoped role `valo_workspace_scope` may call it.
- It adds no table or column, and reads and changes no existing row.

**The application code depends on this migration for the five premium forms.** Starting the
Service agreement, Consultancy agreement, Non-disclosure agreement, Employment contract or Offer letter
form, or adding one to a document, asks the function. Until the migration is applied, those starts fail
because the function is missing. Documents already made, the other seven forms and every other route
work as before.

The Replit development database has no Drizzle ledger. Follow the existing procedure in
[phase1-migration-plan.md](phase1-migration-plan.md):

1. Confirm the database is at the rule sign-off migration (`valo_rule_owner_signoffs` exists) and that
   `SELECT to_regprocedure('public.valo_workspace_holds_template(text,text)')` returns null.
2. Pause writes and the worker. Take a fresh encrypted backup.
3. Apply the file on its own inside a transaction, from the repository root:

   ```sh
   PGOPTIONS='-c lock_timeout=5s -c statement_timeout=60s' \
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f lib/db/drizzle/20261124163621_form_template_purchases.sql
   ```

4. Check that `SELECT to_regprocedure('public.valo_workspace_holds_template(text,text)')` names the
   function, and that
   `SELECT has_function_privilege('valo_workspace_scope', 'public.valo_workspace_holds_template(text,text)', 'EXECUTE')`
   is true.
5. Record the target, commit, file hash, operator, result and time outside customer logs.
   Do not add rows to `drizzle.__drizzle_migrations`.

To roll back, drop the function `valo_workspace_holds_template(text, text)`. The premium forms then
refuse every new start until it is applied again.
