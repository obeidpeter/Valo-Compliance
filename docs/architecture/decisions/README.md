# Architecture decision records

Each record states one decision, why it was made and what it costs. Records are
never edited after acceptance; a later record supersedes an earlier one.

| No. | Decision | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith-with-enforced-boundaries.md) | Modular monolith with enforced module boundaries | Accepted |
| [0002](0002-open-pull-request-settlement.md) | Settle the five open pull requests | Accepted |
| [0003](0003-session-verification.md) | Verify sessions locally; live checks for sensitive actions | Accepted |
| [0004](0004-evidence-files.md) | Keep existing evidence files; record new evidence in CI | Accepted |
| [0005](0005-hosting-without-spend.md) | Prepare hosting in code; provision nothing without approval | Accepted |
| [0006](0006-public-repository.md) | The repository is public | Accepted |
| [0007](0007-port-prs-29-and-31-by-merge.md) | Port PRs 29 and 31 by merging them | Accepted |
| [0008](0008-workspace-row-level-security.md) | Enforce workspace scoping with PostgreSQL row-level security | Accepted |
| [0009](0009-lint-with-oxlint.md) | Lint with oxlint instead of ESLint | Accepted |
