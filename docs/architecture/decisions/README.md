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
| [0010](0010-ci-test-results-as-requirement-evidence.md) | Cite CI test results as requirement evidence | Accepted |
| [0011](0011-server-rendered-public-pages.md) | Server-render the public pages | Accepted |
| [0012](0012-split-the-store.md) | Split the store into workspaces, documents and support tickets | Accepted |
| [0013](0013-move-the-ai-lanes.md) | Move the AI lanes into a module of their own | Accepted |
| [0014](0014-publish-reviewed-pairs.md) | Publish reviewed pairs, and who runs the enhanced checks | Accepted |
| [0015](0015-run-the-editorial-cases.md) | Run the 60 editorial evaluation cases (EDP-010) | Accepted |
| [0016](0016-record-independent-review.md) | Record the independent reviewer's decisions on the acceptance cases | Proposed |
| [0017](0017-clear-guidance-holds.md) | What clears each of guidance's six standing holds | Proposed |
| [0018](0018-manual-library-publishing.md) | Manual publishing for practical guides, industry introductions and templates | Accepted |
| [0019](0019-reuse-sign-in-check-on-four-read-routes.md) | Reuse a passed sign-in check on four more read routes | Accepted |
| [0020](0020-owner-signed-checker-rules.md) | Owner sign-off for requirements-checker rules | Proposed |
