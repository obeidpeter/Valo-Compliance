# 0008 — Enforce workspace scoping with PostgreSQL row-level security

Date: 2026-11-17. Status: accepted (owner instructions "add row-level security for
workspace scoping", "narrow the scoped role's privileges" and "move the inference
ledger writes behind a function"). The design choices below are the implementer's;
review them in the pull request.

## Context

Workspace scoping was enforced by application code alone: every customer query
filters on the workspace the server resolved from the membership, a branded
`WorkspaceActor` type keeps browser input out, and the SEC-001 suite tries every
private route with another workspace's identifiers. One missing filter in one query
would still read or change another workspace's rows, and nothing below the
application would stop it.

## Decision

- A `NOLOGIN NOBYPASSRLS` role, `valo_workspace_scope`, may run only the commands
  customer requests use, table by table (`WORKSPACE_SCOPE_PRIVILEGES` in
  `lib/db/scripts/workspace-row-security.mjs`). The list was derived from every
  query reachable from the customer routes, checked against the statements the
  database job's tests run as the role. 16 of the 71 tables give it nothing: the
  staff, editorial, source monitoring, safety audit and erasure inventory tables,
  public access requests, and the inference budget and its events. It may only read
  and lock published content, prices and rules. On `valo_workspaces` it may update
  only the profile revision, never the owner. New tables give it nothing until a
  migration grants it.
- PostgreSQL lets a role lock rows (`FOR SHARE`, `FOR UPDATE`) only if it may update
  them. Customer requests lock memberships, prices, content versions, support
  tickets, file records and approved inference batches without changing them, so
  those tables give the role `UPDATE` and a trigger refuses every update it attempts.
- The shared inference ledger (the budget, its events and the batches' recorded
  results) is written only through three functions that run as their owner:
  `valo_inference_budget_lock` creates the allocation once and locks it,
  `valo_inference_budget_commit` stores a new state with its event and version, and
  `valo_inference_batch_record_result` records a provider result once, for a key of
  the batch's approved manifest. Every caller uses them. When the caller is the
  scoped role, the commit allows only what a customer AI attempt does: the customer
  allocation, new customer reservations funded for their worst case, statuses that
  only move forward, a settlement within its reservation with a receipt used once,
  holds that only tighten, the customer lane's slots, the allocation's cap and the
  dispatch concurrency. Other callers keep the application's own checks.
- Every table holding workspace rows has one permissive policy for that role: it
  may read and write only rows whose workspace is the transaction's
  `valo.workspace_id`. Payment events have no workspace column; their policy
  follows the order, refund or dispute they reference. With no workspace set, the
  policies match no row. They are declared in the Drizzle schema, so the snapshot
  records them.
- Customer requests enter the scope once, in the identity middleware, right after
  the workspace is resolved: `runInWorkspaceScope(actor.workspaceId, next)`. Every
  connection the shared pool hands out during that request is scoped. Each
  transaction switches to the role with transaction-local settings immediately after
  `BEGIN`. A statement sent outside a transaction runs in a scoped transaction of its
  own. Nothing scoped can outlive a transaction, and a connection released in the
  middle of one is destroyed.
- The application role owns the tables and is not subject to row security. Staff
  routes, background workers, operator commands and migrations keep working across
  workspaces as before. The scope is not a credential boundary: code in a scoped
  transaction could still reset its role. It is a second line behind the workspace
  filters, which stay.

## Alternatives not taken

- **Wrapping each service function.** About 90 functions take a workspace actor; any
  one missed would be unprotected. Entering the scope where the actor is resolved
  covers every customer request, including code added later.
- **Making the application role itself subject to row security**, with system
  work opting out. That fails closed everywhere at once. It also needs a separate
  login role or `FORCE ROW LEVEL SECURITY` with a non-superuser connection in every
  environment. That is a credential and provisioning change for the owner.
- **Column-level grants everywhere.** Only `valo_workspaces` uses one, to protect
  the owner. Elsewhere a new column in an existing update would fail at runtime for
  little gain, since row security already confines the role to its workspace.
- **Row security on the locked shared tables** instead of the lock-only trigger.
  The editorial roles also read and write content versions, and would need
  policies of their own.
- **The whole budget logic in the database.** The ledger's rules (reservation,
  pairs, history reconciliation) stay in TypeScript. The commit function repeats
  only the rules that bound what a customer request can spend or erase, with the
  cap and prices copied from the allocation; changing those needs a migration.

## Consequences

- A table that holds workspace rows needs the workspace policy in the same
  migration that creates it. The migration tests fail on any table with a
  `workspace_id` column that lacks it, on any other policy (which could only widen
  access), on any grant that differs from the list, on default privileges for new
  tables, and on any function the role may call that runs as its owner, except the
  listed ones.
- Customer code that starts using a table, command or column fails with
  `permission denied` until a migration grants it. That fails closed, and the
  database tests show it.
- A customer request cannot see other workspaces' rows, so a query that is meant
  to count them changes meaning. The customer AI limits (the shared daily ceiling
  and each person's per-minute limit) did; they now read the counts from
  `valo_customer_ai_reservations`, a function that runs as its owner, returns only
  the two totals and does not trust the caller's `search_path`. A review of every
  customer query without a workspace filter found no other.
- Tests that build the ledger in a disposable schema copy the functions into it
  (`copyDatabaseFunctions`), so every ledger test runs through them.
- Customer requests send a few more statements per transaction: one after `BEGIN`,
  and `BEGIN` and `COMMIT` around a statement that ran alone.
- The migration must be applied before this code runs. Until then, customer requests
  fail with `DB_WORKSPACE_SCOPE_UNAVAILABLE`, and no connection is leaked.
- Routes registered before the identity middleware, such as the privacy requester
  routes, are not scoped. They keep their own checks.
