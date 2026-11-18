# 0010 — Cite CI test results as requirement evidence

Date: 2026-11-17. Status: accepted (owner instruction of 17 November to do the
"let new evidence count" step of the plan).

## Context

The readiness report (`pnpm --filter @workspace/scripts valo:readiness`) lists the
evidence for each requirement from the evidence files in `docs/valo/evidence/`.
Decision 0004 froze those files and sends new run evidence to CI artifacts, so the
report could not show anything built since: none of the workspace isolation, row
security or architecture checks counted toward a requirement, and nothing new would.

## Decision

- `docs/registers/ci-evidence.json` cites tests as evidence. A citation names the
  requirement, the CI job that runs the test, the test file, the test's exact
  top-level name and, in one sentence, what the test shows.
- In CI, every job with citations loads `scripts/src/valo/test-results-reporter.mjs`
  through `NODE_OPTIONS`, next to the usual `spec` output. It records how every test
  ended (passed, failed, skipped or todo, and the same for the tests inside it), and
  the job uploads the records as `test-results-<job>-attempt-<n>`, n being the run attempt.
  The evidence job reads each job's latest attempt, so re-running a job replaces its earlier
  results.
- Each such job ends by checking its citations (`valo:ci-evidence --job <job>`). A
  cited test counts only when it ran and passed and nothing inside it failed, was
  skipped or is a todo. Otherwise the job fails, so green CI on a commit means every
  cited test passed on that commit.
- The `evidence` job collects every job's records, writes the readiness report with
  each citation's result for the run, uploads it as `readiness-report`, adds a table
  to the run summary and fails if any citation did not pass.
- A unit test checks that every citation names a known requirement and job, an
  existing test file and a test with exactly that name, once, and that the workflow
  records, checks and collects the results of every cited job.

Evidence never accepts anything. Each requirement stays blocked in the readiness
report until the acceptance evidence and approvals the specification names exist, and
a citation describes only what its test shows.

## Consequences

- New evidence is a reviewed line in a register, backed by a test CI runs on every
  commit, instead of a frozen file.
- Renaming or skipping a cited test fails CI until the register is updated.
- The readiness report for a commit is the `readiness-report` artifact of its CI run.
  Run locally, it lists the citations as not run.
- `NODE_OPTIONS` is set in each job's own `env`, because the runner ignores `NODE_OPTIONS`
  written to `$GITHUB_ENV`; the wiring check fails any step that tries. In the database job its
  last option loads the nested-connection preload once a step sets `VALO_NESTED_PRELOAD`.
