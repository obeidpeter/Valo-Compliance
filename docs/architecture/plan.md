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
| Linter | done with oxlint instead of ESLint, whose TypeScript parser and Next.js plugin depend on `picomatch` (decision 0009). It runs with type information in `pnpm run lint` and CI: correctness and suspicious rules, promises nobody awaits, the rules of hooks, Next.js and accessibility. Rules turned off and every inline exception give their reason. Until 19 November, ten versions already locked are exempt from the 7-day release window, each pinned to its locked version (`pnpm-workspace.yaml`); remove the exemptions then. |
| TypeScript: strictFunctionTypes, noUnusedLocals/Parameters, noImplicitOverride | done |
| TypeScript: exactOptionalPropertyTypes (91 errors), noUncheckedIndexedAccess (825) | not started |
| Generated API client checked against the contract in CI | done |
| Typed settings registry and generated `.env.example`; reading an unregistered variable fails a test | done |
| One test command with lanes and its own database | in progress (`pnpm test` runs typecheck, lint and the fast suites; a test fails when a test file is run by no script; database groups still run as separate CI steps) |
| Delete unused UI kit, packages, `mockup-sandbox` | done: 52 components, `mockup-sandbox` and its packages, the 40 web app packages nothing imports (99 fewer locked packages), and the 12 version catalog entries no package used |
| Safe error logging; no silently discarded errors | done (errors are logged by class, code and stack frames, never by message; empty catches need a reason) |

Exit: CI rejects unformatted code, lint findings, stray environment reads and discarded errors.

### Phase 2 — Modules

| Item | Status |
| --- | --- |
| Move API code into `platform/` and `modules/` with public entry files | not started |
| Remove the three import cycles | done: the last ran through the inference dispatcher, which loaded its work-binding checks and through them the callers that call it. The operator commands that run approved work now hand the dispatcher those checks (`provideFiniteWorkBindings`), and the repository rules checker rejects any import cycle and any unreviewed caller of that function (`inference-bindings`) |
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
| Workspace context object required by every query | done: the actor is a server-issued type created only from a membership or a stored record; HTTP code cannot create, cast or redirect one (rule `workspace-actor`). Every customer request also acts as `valo_workspace_scope`, and PostgreSQL row-level security limits it to the workspace's rows (decision 0008). That role holds only the privileges customer requests use, table by table, and new tables give it nothing until a migration grants it; the migration tests fail on any other grant. The shared inference ledger is written only through reviewed database functions, which allow a customer request only what a customer AI attempt does. The scope is a credential boundary: customer connections log in as `valo_workspace_login`, which may become only the scoped role, and each transaction names its workspace with a credential the application signs for that transaction alone; connections are reset between requests. Background work for one workspace (document and data exports, reminders, a staff privacy export) reads that workspace's data in its scope; only the identity middleware and those jobs may enter a scope. |
| R2 membership design | done as a proposal ([r2-team-access.md](r2-team-access.md)); five owner decisions listed |
| Adopt the migration ledger on the Replit development database | blocked (needs access to that database) |
| No pooled connection taken inside a transaction | done: every database suite in CI now records any pooled connection taken while its transaction holds one, and the job fails on anything but a reviewed exception (`nested-connection-report.mjs`, which first proves it still detects a canary). Commerce read its catalogue inside transactions; fixed. The one exception is the workspace data export, which checks access on separate short transactions by design; it is now capped at two concurrent exports per process. Template downloads, drafts and saves read their storage evidence before their transaction and the file bytes after it. A remaining case would fail after the pool's 10-second acquisition timeout instead of hanging. |
| Constraint names in hand-written migrations match the Drizzle snapshot | done: `20261117112017_constraint_names` renames the 46 keys that migrations 0007–0032 let PostgreSQL name; this branch's unapplied 0035 and 0037 were corrected in place. The schema now declares the keys and indexes the database already had and no longer declares four payment-concern foreign keys that never existed. The schema also declares the 83 check constraints it lacked, under their database names, so the latest snapshot records all 102. The migration tests compare every key, check and index of a migrated database with the latest snapshot, check expressions as PostgreSQL normalizes them. |
| Generated web client encodes path parameters | done: generated functions encode every path parameter, and their cache keys name the operation with each identifier as its own element, so no identifier can reach another operation's endpoint or cached data. The shared transport refuses an empty, `.` or `..` path segment, which encoding cannot make safe, before sending. A contract-driven test checks every operation with a path parameter. |

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
