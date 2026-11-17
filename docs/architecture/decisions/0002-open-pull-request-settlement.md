# 0002 — Settle the five open pull requests

Date: 2026-11-16. Status: accepted (owner instruction "implement all" on the
recommended plan).

## Context

Five draft pull requests had drifted 78–107 commits behind the integration
branch and all had merge conflicts. Three reused migration numbers already taken.

## Decision

- Merge PR 27, PR 24 and PR 26 into the working branch, resolving conflicts and
  renumbering PR 26's migration to `0035_saved_templates`.
- Port PR 29 (editorial lifecycle and source corrections) and PR 31 (support
  cases) into the new module layout instead of resolving 14 and 8 conflicting
  files against code that is about to move. Their migrations get new numbers.

## Consequences

- The original PR 24, 26 and 27 close automatically once the working branch is
  merged into the integration branch.
- PR 29 and PR 31 stay open as references until their ports land.
