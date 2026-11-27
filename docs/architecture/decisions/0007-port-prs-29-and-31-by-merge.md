# 0007 — Port PRs 29 and 31 by merging them

Date: 2026-11-17. Status: accepted (owner instruction "port PRs 29 and 31 now").
Supersedes the PR 29 and PR 31 parts of [0002](0002-open-pull-request-settlement.md).

## Context

Decision 0002 planned to rewrite PR 29 (source corrections and the editorial
lifecycle) and PR 31 (support cases) into a new module layout, keeping both pull
requests open as references. That layout is not ready, and the owner asked for
both ports now.

## Decision

- Merge each pull request's head into the working branch with a real merge
  commit, resolving conflicts and adapting the code to current conventions.
- Renumber their migrations to 0037 and 0038 (PR 29) and 0039 (PR 31).
- Make behaviour changes needed after the merge in separate commits.

## Consequences

- PR 29 and PR 31 show as merged once the working branch reaches the
  integration branch.
- Their code still lives in the flat `src/lib` layout and moves with everything
  else in Phase 2.
- The ports change some of their design. These are recorded in the merge
  commits, in their checkpoint documents and in the pull request description.
