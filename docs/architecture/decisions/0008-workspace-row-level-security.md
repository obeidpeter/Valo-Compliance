# 0008 — Enforce workspace scoping with PostgreSQL row-level security

Date: 2026-11-17. Status: accepted (owner instruction "add row-level security for
workspace scoping"). The design choices below are the implementer's; review them in
the pull request.

## Context

Workspace scoping was enforced by application code alone: every customer query
filters on the workspace the server resolved from the membership, a branded
`WorkspaceActor` type keeps browser input out, and the SEC-001 suite tries every
private route with another workspace's identifiers. One missing filter in one query
would still read or change another workspace's rows, and nothing below the
application would stop it.

## Decision

- A `NOLOGIN NOBYPASSRLS` role, `valo_workspace_scope`, holds the application's
  table privileges without DDL, `TRUNCATE`, `REFERENCES` or `TRIGGER`. Every table
  holding workspace rows has one permissive policy for that role: it may read and
  write only rows whose workspace is the transaction's `valo.workspace_id`. With no
  workspace set, the policy matches no row. The policies are declared in the
  Drizzle schema, so the snapshot records them.
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
- **Least privilege for the scoped role now.** Its table privileges match the
  application's today, so no customer flow can break on a missing grant. Narrowing
  them to the tables customer requests use is a follow-up.

## Consequences

- A table that holds workspace rows needs the workspace policy in the same
  migration that creates it. The migration tests fail on any table with a
  `workspace_id` column that lacks it, on any other policy (which could only widen
  access), and on any dangerous privilege the role gains.
- Customer requests send a few more statements per transaction: one after `BEGIN`,
  and `BEGIN` and `COMMIT` around a statement that ran alone.
- The migration must be applied before this code runs. Until then, customer requests
  fail with `DB_WORKSPACE_SCOPE_UNAVAILABLE`, and no connection is leaked.
- Routes registered before the identity middleware, such as the privacy requester
  routes, are not scoped. They keep their own checks.
