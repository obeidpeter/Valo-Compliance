# 0012 — Split the store into workspaces, documents and support tickets

Date: 2026-11-18. Status: **accepted** on 2026-11-20 by the product owner's instruction "I approve
everything that needs approval. Then implement all", given in reply to a list of the decisions
waiting on them. Both decisions below are taken as proposed: the split as described, and no
`identity` module.

## Context

`artifacts/api-server/src/lib/valo-store.ts` (428 lines) is the last large shared file in
`src/lib`. It holds four kinds of thing:

| Part | Functions | Used by |
| --- | --- | --- |
| Workspace access | `authorizeWorkspaceRead`, `authorizeWorkspaceWrite`, `limitWorkspaceWrite`, and the private `event` helper that writes the workspace's audit trail | 15 files in commerce, catalogue, exports, privacy, rules, support and the source controls |
| Workspaces | `resolveWorkspace` (an identity's membership to a `WorkspaceActor`, refusing erased identities), `getWorkspace`, `saveProfile` | the identity middleware, the routes, a test fixture, four scripts and many tests |
| Documents | `listDocuments`, `getDocument`, `listRevisions`, `createDocument`, `createDocumentInTransaction`, `saveDocument` | the routes, customer AI, released content, the editorial runtime and five scripts |
| Support tickets | `createTicket`, `createTicketInTransaction`, which open a support case through `valo-support-intake.ts` | the routes and the privacy code |

It also re-exports `ValoProblem`, and 14 files import that class from the store rather than
from `valo-problem.ts`.

The target layout names `identity`, `workspaces` and `documents` modules. Keeping the store whole
also keeps two things out of their modules:

- The support intake stays in `src/lib`: the store opens cases through it, and the support
  lifecycle reads the store.
- The privacy keys stay in `src/lib`: the store hashes identities with them, and the privacy
  code reads the store.

## Decision

Split the store along those lines. Each step is a pure move in its own pull request, with
callers, tests and registers following the new paths, as for the other modules.

1. **`modules/workspaces`** takes the workspace access checks, write limits, workspace resolution,
   the workspace and its profile. The audit `event` helper moves with them and becomes public,
   because documents and support tickets write the same audit trail.
2. **`modules/documents`** takes the six document functions and the revision codec
   (`valo-revision-codec.ts`). It depends on `modules/workspaces`, never the other way.
3. **`modules/support`** takes the two ticket functions and the support intake. With tickets in
   the same module as the cases they open, the cycle that kept the intake out is gone.
4. The 14 files that import `ValoProblem` through the store import it from `valo-problem.ts`.
5. **No `identity` module.** Session verification and the workspace context already live in
   `platform/`, which the target layout gives "identity context". `resolveWorkspace` goes to
   workspaces, because it reads memberships and the workspace. The target layout's `identity/`
   entry would be removed.

The privacy keys stay in `src/lib`. Workspace resolution checks erased identities with them, and
the privacy code checks workspace access, so either module owning the keys would make a cycle.
The shared request validators (`valo-validation.ts`) also stay, for now.

## How it will be checked

As for every module so far:
- the repository rules find no import cycle and no import past an index;
- no index loads the database client at the top, which the lazy-loading pattern and the
  database-free test groups check;
- the worker-startup boundary test, all foundation groups, the recovery drills and the full
  database suite pass locally;
- hosted CI passes on each pull request's head commit.

## Consequences

- `src/lib` keeps only shared helpers, the privacy keys, the recovery and operations tools, and
  the leftovers the plan lists.
- The `workspace-actor` repository rule names the store as the only file, besides the workspace
  context, that may issue an actor from a membership (`resolveWorkspace`). That path follows the
  move, and nothing else may issue one.
- The move touches many imports: about 30 product files and the tests that import the store.

## Decisions for the product owner

1. Approve this split, or choose other boundaries.
2. Agree to drop `identity` from the target layout, leaving the identity context in `platform/`.
