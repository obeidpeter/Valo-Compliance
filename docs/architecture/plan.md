# Maintainability and scale plan

This plan restructures Valo in place. It keeps the stack chosen in the brief
(modular monolith, PostgreSQL, pg-boss, Clerk, Next.js, typed OpenAPI contract)
and changes how the code is organised, checked and run. Every phase leaves the
application working and CI passing. Moving code and changing behaviour never
share a commit.

Status values: **done**, **in progress**, **not started**, **blocked** (needs an
owner decision or spend).

## Why

Measured on the integration branch at `14c8f38`:

| Problem | Evidence |
| --- | --- |
| No module boundaries | 202 files in one `src/lib` folder; 90 of 237 API source files use the database directly; three import cycles, the largest spanning 11 files. |
| Hard-to-read code | No formatter or linter; 12–18% of lines exceed 120 characters. |
| Scattered settings | 277 environment reads in 103 files covering 87 variables; `NODE_ENV` checked in 42 files; no `.env.example`. |
| Shared files cause collisions | One CI file with 65 hand-written steps, 75 hand-listed test scripts, one 3,846-line API contract, one migration list. |
| Undiagnosable failures | The logger discards every error message and stack; 66 `catch` blocks discard errors; unknown failures all return the same 503. |
| Dead code | 52 of 55 UI kit components unused; an unused template app (`mockup-sandbox`). |
| Slow request path | Two Clerk API calls per signed-in request; two database writes per API read for rate limiting; nothing cacheable. |
| One user, one workspace | Fixed by two unique indexes and assumed by every route; blocks R2 teams. |

## Phases

### Phase 0 — Prepare

| Item | Status |
| --- | --- |
| Merge open PRs 27, 24 and 26 (migration renumbered to 0035) | done |
| Port PRs 29 and 31 into the new module layout | not started (Phase 6) |
| Fix `finite-inference-run` command mismatch, drill route probes, licence field | done |
| Run CI on agent branches; align CI Node version with the Replit runtime (24) | done |
| Architecture overview, this plan, decision records, `AGENTS.md` | done |
| README reduced to a front page; checkpoint log preserved as history | done |

### Phase 1 — Automatic checks

| Item | Status |
| --- | --- |
| Formatter and linter, one mechanical reformat commit | not started |
| Full TypeScript strictness | not started |
| Typed settings module with startup validation and `.env.example` | not started |
| One test command with lanes and its own database | not started |
| Delete unused UI kit, packages, `mockup-sandbox` | not started |
| Safe error logging; no silently discarded errors | not started |

Exit: CI rejects unformatted code, stray environment reads and discarded errors.

### Phase 2 — Modules

| Item | Status |
| --- | --- |
| Move API code into `platform/` and `modules/` with public entry files | not started |
| Remove the three import cycles | not started |
| Split the API contract per module; add the ~11 missing routes | not started |
| Worker loop becomes scheduled queue jobs | not started |
| Separate product logic from requirement/evidence bookkeeping in `valo-core` | not started |

Exit: CI forbids reaching inside another module; payments, sign-in and rules
reach the 80% branch coverage NFR-011 requires.

### Phase 3 — Data layer

| Item | Status |
| --- | --- |
| Regenerate schema snapshots; timestamp-named migrations | not started |
| Workspace context object required by every query; automatic cross-workspace route tests | not started |
| R2 membership design | not started |
| Adopt the migration ledger on the Replit development database | blocked (needs access to that database) |

### Phase 4 — Speed and capacity

| Item | Status |
| --- | --- |
| Local session verification, live checks for sensitive actions | not started |
| Rate-limit cleanup off the request path | not started |
| Published-content cache with invalidation | not started |
| Reuse one browser for PDFs, five in parallel | not started |
| Server-rendered public pages, split bundle, self-hosted fonts | not started |

### Phase 5 — Environments and operations

| Item | Status |
| --- | --- |
| Container image and environment profiles | not started |
| Release and rollback procedure | not started |
| Metrics, error tracking hooks, alert definitions | not started |
| Backup retention policy (backups are never pruned today) | not started |
| Staging and production environments | blocked (needs spend approval) |

### Phase 6 — Content operations

| Item | Status |
| --- | --- |
| Publish path from passing reviews to published versions | not started |
| Rule release path through the editorial gates | not started |
| Owner approval command for the AI budget | not started |
| Editorial staff screen, high-risk checks, source monitoring, user notices | not started |
| Acceptance suites against the live engine | not started |

## What this plan does not do

- No microservices, framework swap or rewrite.
- No change to the safety checks that refuse by default.
- No spending, launch, live payments or real data without owner approval.
