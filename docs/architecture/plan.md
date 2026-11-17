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
| Port PRs 29 and 31 | done by merge (decision 0007); migrations renumbered to 0037–0039 |
| Fix `finite-inference-run` command mismatch, drill route probes, licence field | done |
| Run CI on agent branches; align CI Node version with the Replit runtime (24) | done |
| Architecture overview, this plan, decision records, `AGENTS.md` | done |
| README reduced to a front page; checkpoint log preserved as history | done |

### Phase 1 — Automatic checks

| Item | Status |
| --- | --- |
| Prettier formatter, one mechanical reformat commit, CI format check | done |
| Repository rules checker (empty catches need a reason; no new import cycles) in CI | done |
| ESLint | blocked (adding any dependency fails the supply-chain checks on already-locked packages: `pino` 9.14.0 trust downgrade; `pg-boss` 12.38.2 and `@scalar/openapi-parser` inside the 7-day window until about 17 November). Fix by upgrading `pino` to a release with provenance, then add ESLint. |
| TypeScript: strictFunctionTypes, noUnusedLocals/Parameters, noImplicitOverride | done |
| TypeScript: exactOptionalPropertyTypes (91 errors), noUncheckedIndexedAccess (825) | not started |
| Generated API client checked against the contract in CI | done |
| Typed settings registry and generated `.env.example`; reading an unregistered variable fails a test | done |
| One test command with lanes and its own database | in progress (`pnpm test` runs typecheck, lint and the fast suites; a test fails when a test file is run by no script; database groups still run as separate CI steps) |
| Delete unused UI kit, packages, `mockup-sandbox` | in progress (52 components and `mockup-sandbox` removed; their npm packages are pruned once the lockfile can change) |
| Safe error logging; no silently discarded errors | done (errors are logged by class, code and stack frames, never by message; empty catches need a reason) |

Exit: CI rejects unformatted code, stray environment reads and discarded errors.

### Phase 2 — Modules

| Item | Status |
| --- | --- |
| Move API code into `platform/` and `modules/` with public entry files | not started |
| Remove the three import cycles | in progress (two removed; the third shrank from 13 to 8 files and needs the inference dispatcher to receive its lanes from a composition root) |
| Every client-facing route in the API contract | done (the staff MFA check was the last one missing; the Paystack webhook faces the provider and stays outside the client contract) |
| Split the API contract per module | not started |
| Worker loop becomes scheduled queue jobs | not started |
| Separate product logic from requirement/evidence bookkeeping in `valo-core` | not started |

Exit: CI forbids reaching inside another module; payments, sign-in and rules
reach the 80% branch coverage NFR-011 requires.

### Phase 3 — Data layer

| Item | Status |
| --- | --- |
| Regenerate schema snapshots; timestamp-named migrations; CI fails on schema changes without a migration | done |
| Automatic cross-workspace route tests (SEC-001) | in progress: every private customer operation in the contract that takes a workspace-owned identifier (30) is tried by another workspace, whose reply must equal the reply for an unknown identifier while the owner's rows stay unchanged; a guard fails on any new uncovered operation. The template file purchase check has its own isolation test. |
| Workspace context object required by every query | in progress: the actor is a server-issued type created only from a membership or a stored record; HTTP code cannot create, cast or redirect one (rule `workspace-actor`). Query-level enforcement (row-level security) not started. |
| R2 membership design | done as a proposal ([r2-team-access.md](r2-team-access.md)); five owner decisions listed |
| Adopt the migration ledger on the Replit development database | blocked (needs access to that database) |
| No pooled connection taken inside a transaction | done for commerce: the catalogue is read outside the purchases, order and checkout transactions. The commerce suite fails if any call takes a second connection inside a transaction (`src/test-support/nested-connection-guard.ts`), and 25 concurrent purchase listings finish. Other modules are not checked yet. Download transactions still read publication artifacts from storage while holding the source-state lock. A remaining case now fails after the pool's 10-second acquisition timeout instead of hanging. |
| Constraint names in hand-written migrations match the Drizzle snapshot | not started: most hand-written migrations, including 0037, let PostgreSQL name their keys and foreign keys, while the snapshot uses Drizzle's names. A generated migration that drops or alters one of those constraints must be checked by hand. 0039 uses the snapshot's names. |
| Generated web client encodes path parameters | not started: generated functions insert identifiers into paths as given. The support client encodes them itself. |

### Phase 4 — Speed and capacity

| Item | Status |
| --- | --- |
| Local session verification, live checks for sensitive actions | done (everyday routes re-check Clerk at most once a minute per session; sensitive and unlisted routes check live) |
| Rate-limit cleanup off the request path | done |
| Published-content cache with invalidation | not started |
| Reuse one browser for PDFs, five in parallel | done |
| Server-rendered public pages, split bundle, self-hosted fonts | not started |

### Phase 5 — Environments and operations

| Item | Status |
| --- | --- |
| Container images (API, web) built and start-checked in CI; environment profiles documented | done |
| Release and rollback procedure | done ([release-and-rollback.md](../valo/release-and-rollback.md)) |
| Alert definitions in one place | done (catalogue of the existing internal and external alerts) |
| External error tracking and metrics service | blocked (a new dependency and a new processor of operational data; needs owner approval) |
| Backup retention policy (backups are never pruned today) | blocked (35-day policy proposed with a tested dry-run planner; nothing is removed until the owner approves it) |
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
