# 0008 — Enforce workspace scoping with PostgreSQL row-level security

Date: 2026-11-17. Status: accepted (owner instructions "add row-level security for
workspace scoping", "narrow the scoped role's privileges", "move the inference
ledger writes behind a function" and "make the scope a credential boundary"). The
design choices below are the implementer's; review them in the pull request.

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
  may read and write only rows whose workspace is `valo_scope_workspace()`, the
  workspace the transaction's credential names. Payment events have no workspace
  column; their policy follows the order, refund or dispute they reference. Without
  a valid credential the policies match no row. They are declared in the Drizzle
  schema, so the snapshot records them.
- Customer requests enter the scope once, in the identity middleware, right after
  the workspace is resolved: `runInWorkspaceScope(actor.workspaceId, next)`. Every
  connection the shared pool hands out during that request comes from a second
  pool, which logs in as `valo_workspace_login` (`VALO_CUSTOMER_DATABASE_URL`). Each
  transaction switches to the scoped role with transaction-local settings
  immediately after `BEGIN`. A statement sent outside a transaction runs in a scoped
  transaction of its own. Nothing scoped can outlive a transaction, and a connection
  released in the middle of one is destroyed.
- The scope is a credential boundary: SQL running on a customer connection, such as
  an injected statement, cannot act as the application role or for another
  workspace.
  - `valo_workspace_login` is `NOINHERIT`, may become only `valo_workspace_scope`,
    and holds nothing itself. Resetting the role leaves a connection that can read
    nothing and cannot become the application role. Neither role may create objects
    in `public` or create schemas.
  - The workspace comes from a credential the application signs. Each process
    registers a random key through the application role in `valo_scope_keys`,
    which only the application role can read. Keys last seven days, are replaced
    when one day is left, and are deleted a day after they expire. After `BEGIN` the
    application asks the database which backend and transaction start time it is
    in, and sends `<workspace>:<key id>:<HMAC-SHA256 of workspace, backend and start
    time>` as a bind parameter in `valo.workspace_credential`.
    `valo_scope_workspace()` runs as its owner, does not trust the caller's
    `search_path`, and returns the workspace only if the signature matches the
    current backend and transaction. A credential read in one transaction is refused
    in every other, on any connection.
  - Each scoped transaction starts with `RESET ALL` and searches temporary tables
    after `public`, so settings or a temporary table that earlier SQL left on the
    connection cannot redirect it. On release, a connection is reset with
    `DISCARD ALL`, so no temporary table, setting, session lock or prepared
    statement reaches the next request. A connection still in a transaction, or
    whose reset fails, is destroyed.
  - On its first checkout each connection must prove that it is logged in as
    `valo_workspace_login` and that the database accepts this process's key.
    Otherwise it is destroyed and the request fails with
    `DB_WORKSPACE_SCOPE_UNAVAILABLE`.
- The application role owns the tables and is not subject to row security. Staff
  routes, background workers, operator commands and migrations keep working across
  workspaces as before. The scope is a second line behind the workspace filters,
  which stay.

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
- **Setting the workspace id directly**, as the first version did. Any SQL on the
  connection could set another workspace's id, or reset the role to the application
  role, which owned the connection.
- **One login per workspace.** Thousands of roles, each with its own connections,
  and every new workspace would need a privileged role change.
- **Binding the credential to the connection only.** SQL that once read a
  credential could reuse it on the same connection for as long as the key lasted,
  including in a later request for another workspace.
- **Refusing connections whose announced backend differs from the one answering**,
  to keep transaction poolers out. Proxies that pass one session straight through
  but hand the client their own cancel key, as Neon's does, would fail it too.
  Each transaction resets its own settings and is bound to its own backend
  instead.
- **`pgcrypto` for the signature.** It is an extension that each environment would
  have to install. The built-in `sha256` computes the same HMAC.
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
- Customer requests make a few more round trips: `BEGIN` travels with the query
  for the backend and start time, then the credential follows; a statement that
  ran alone gets `BEGIN` and `COMMIT` around it; and each release sends
  `DISCARD ALL`. A `BEGIN` with anything but words in it costs one more.
- Customer connections come from their own pool, with the same size as the
  application's, so a process may hold up to twice as many connections.
  `VALO_CUSTOMER_DATABASE_URL` must reach the database directly or through a
  session pooler. Through a transaction pooler workspaces would still stay apart,
  but a session lock a request left could block other clients, and `DISCARD ALL`
  would reset whichever session the pooler picked.
- Each environment must enable the login once, with a password from its secret
  store (`lib/db/scripts/workspace-login.mjs`), and store the connection string
  that script prints as `VALO_CUSTOMER_DATABASE_URL`.
- PostgreSQL lets sessions of one login see and signal each other. SQL on a
  customer connection that resets its role could read the statement text other
  customer connections are running, and cancel them. The credential and every
  value customer code sends are bind parameters, which that view does not show.
  Customer code puts only schema, table and role names into statement text.
- The migration must be applied, and the login enabled, before this code runs.
  Until then, customer requests fail with `DB_WORKSPACE_SCOPE_UNAVAILABLE`, and no
  connection is leaked.
- Routes registered before the identity middleware, such as the privacy requester
  routes, are not scoped. They keep their own checks.
