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
| TypeScript: exactOptionalPropertyTypes, noUncheckedIndexedAccess (825) | exactOptionalPropertyTypes is on for every package except `lib/valo-core`, where `checker-business-name.ts` needs two edits and its bytes are bound to its recorded evaluation; it turns on there with the checker's next evaluation. noUncheckedIndexedAccess is not started |
| Generated API client checked against the contract in CI | done |
| Requirement evidence from CI test results | done (decision 0010): `docs/registers/ci-evidence.json` cites tests by name for a requirement; each CI job records how its tests ended and fails when a test cited for it does not pass, and the `evidence` job publishes the readiness report with every citation's result |
| Typed settings registry and generated `.env.example`; reading an unregistered variable fails a test | done |
| One test command with lanes and its own database | done: `pnpm test` runs typecheck, lint and the fast suites, and `pnpm test:db` runs CI's database job against a PostgreSQL cluster it starts and removes. It reads the steps from the workflow, so the groups are listed once, and refuses any step it cannot run as CI does; a test keeps it reading the current workflow. A test fails when a test file is run by no script |
| Delete unused UI kit, packages, `mockup-sandbox` | done: 52 components, `mockup-sandbox` and its packages, the 40 web app packages nothing imports (99 fewer locked packages), and the 12 version catalog entries no package used |
| Safe error logging; no silently discarded errors | done (errors are logged by class, code and stack frames, never by message; empty catches need a reason) |

Exit: CI rejects unformatted code, lint findings, stray environment reads and discarded errors.

### Phase 2 — Modules

| Item | Status |
| --- | --- |
| Move API code into `platform/` and `modules/` with public entry files | in progress: `modules/ai` holds the finite inference core, `modules/commerce` the purchases, payments, receipts, refunds, payment concerns, disputes and Paystack contract, and `modules/rules` the rule registry and saved assessments, each behind its `index.ts`, and the repository rules checker rejects product code that imports a module's other files (`module-boundary`). The inference lanes, the history loader and the work-binding checks stay in `src/lib` until the modules that own their dependencies exist; `src/editorial` needs untangling before it can become modules, because its files import each other in both directions ([architecture](README.md)); the other modules are not started |
| Remove the three import cycles | done: the last ran through the inference dispatcher, which loaded its work-binding checks and through them the callers that call it. The operator commands that run approved work now hand the dispatcher those checks (`provideFiniteWorkBindings`), and the repository rules checker rejects any import cycle and any unreviewed caller of that function (`inference-bindings`) |
| Every client-facing route in the API contract | done (the staff MFA check was the last one missing; the Paystack webhook faces the provider and stays outside the client contract) |
| Split the API contract per module | not started |
| Worker loop becomes scheduled queue jobs | done in development: the seven operational tasks (source checks, reminders, payment events, refunds, disputes, dispute actions, payment reconciliation) are each a job on `valo-operations-v1`, scheduled every minute by the reviewed development queue setup. The queue allows one queued and one active job per task, so a slow task never piles up or holds back another, a failed run stays visible as a failed job, and with several workers each task still runs once a minute. The worker's loop keeps the export outbox and its health probes; its queue check refuses to run without the queue and its schedules. Production runs none of these tasks and has no such queue |
| Separate product logic from requirement/evidence bookkeeping in `valo-core` | done: the requirement records, the traceability and readiness report, the evidence links, the acceptance work items and the handover checkpoint moved to `lib/valo-records` (`@workspace/valo-records`), which depends on `valo-core` and never the other way. The register generators write there. The API reads it only for the public and development status routes and the source register's handover summary, and the web app does not depend on it. The content inventory and catalogue stay in `valo-core`, because the product reads them |
| Branch coverage of payments, sign-in and rules (NFR-011) | done as Node measures it: the database job runs each area's tests with Node's coverage and fails an area below 80% of branches; each run's figures are in its run summary and readiness report. The first hosted run (639db48) measured payment 84.79%, sign-in 91.45% and rules 88.41%. Node counts V8 blocks, so a function no test calls is one uncovered branch, and its figures can be higher than those of a tool that counts every branch. NFR-011 also asks for scenario tests, and a percentage never stands in for negative security cases |

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
| Published-content cache with invalidation | deferred by owner decision (18 November): outside development the released-content reader returns nothing, and the development database has no published content, so a cache would save one policy read and one empty query. It waits for released content and a measured need; it must then be invalidated through the database, because EDP-011 requires a withdrawal made by another process to reach it at once |
| Reuse one browser for PDFs, five in parallel | done |
| Server-rendered public pages, split bundle, self-hosted fonts | in progress: the three fonts are served from the app (`src/fonts.css`, OFL files from Fontsource), so no visitor request goes to Google, and the content security policy allows fonts and styles from the app's own origin only; server-rendered public pages and a split bundle are not started |

### Phase 5 — Environments and operations

| Item | Status |
| --- | --- |
| Container images (API, web) built and start-checked in CI; environment profiles documented | done |
| Release and rollback procedure | done ([release-and-rollback.md](../valo/release-and-rollback.md)) |
| Alert definitions in one place | done (catalogue of the existing internal and external alerts). Every internal alert names its runbook and accountable roles (NFR-010), and the probes count security signals: repeated refusals, signature failures, staff role changes and callers at a quota limit (SEC-008, development thresholds) |
| External error tracking and metrics service | blocked (a new dependency and a new processor of operational data; needs owner approval) |
| Backup retention policy (backups are never pruned today) | blocked (35-day policy proposed with a tested dry-run planner; nothing is removed until the owner approves it) |
| Staging and production environments | blocked (needs spend approval) |

### Phase 6 — Content operations

| Item | Status |
| --- | --- |
| Publish path from passing reviews to published versions | in progress for templates, blocked for guidance. Templates: seventeen templates have candidate preparers (`prepareOperationalCandidateRelease` saves a candidate with its real evidence and a hold), and their factual and challenge reviews run only inside an approved finite AI allocation. The publisher (`publishOperationalVersion`) rechecks every gate (policy, provenance, rights, mechanical checks, two independent passing reviews bound to the candidate, exports and source bindings) before it publishes. Only TPL-07's one-step path (`prepareInventoryRelease`) hands passing reviews to it; for the other templates the finite run stores both reviews with `publicationAccepted: false`, and no command yet turns them into a published version. Its success path needs a real reviewed pair, so the AI spend approval. Guidance: the regulatory pipeline (`editorial/pipeline.ts`) holds every output with six standing reasons (`mandatoryDevelopmentHolds`), each waiting for an owner decision or outside evidence: an approved publication policy, verified current amendments and effective dates, a cleared rights record, an accepted claim scope, validated DOCX and PDF samples, and isolated publisher service credentials |
| Rule release path through the editorial gates | done in development (ADM-004): `src/scripts/rule-release.ts` plans a rule version against the registry and saved profiles (condition, next version, critical regression scenarios, preview of changed results) and applies it only with the operator's confirming manifest hash. It applies the registry's own admission check, reads each source's stored text before its transaction, then binds the sources to their current captures and supersedes the previous version inside it. A prior version is restored by releasing it again as the next one. Nothing produces real release requests yet: that needs the regulatory editorial pipeline, whose reviews are AI runs |
| Owner approval command for the AI budget | done in development: `src/scripts/finite-allocation-approval.ts` prepares the current finite package, records the owner's approval of that exact package for at most 24 hours and revokes it ([operating runbook](../valo/operating-runbooks.md)). Only one approval is current at a time, and the approval is kept only if the dispatcher's own admission check accepts it. A database test approves synthetic packages in an isolated schema; no approval exists, and running the command is the owner's spending decision. The package the 14 November decision packet names predates the clarified allocation boundary and is refused |
| Editorial staff screen, high-risk checks, source monitoring, user notices | in progress. The staff Content area (ported with PR 29) lists content and rule versions with their status, review date and safety holds, the daily source checks and the correction review queue, and lets content staff hold or withdraw a version or start watching an official source. Each version now opens its publication record (ADM-002): what its stored bundle passes or holds on now and why, the drafting and review runs with their models, run IDs, verdicts and findings, its check counts, safety holds and publication audit; reading it needs the content role and fresh MFA and is recorded. User notices: detail pages show the source-check and review dates, the AI-review disclosure, scope and limitations (EDP-008), and customers see correction notices. High-risk checks are not built: the publication gate requires five enhanced checks (controlling text, amendments, effective dates, exceptions, jurisdiction) for every item that is not general, and nothing runs them yet, so every such item stays held |
| Acceptance suites against the live engine | not started |

## What this plan does not do

- No microservices, framework swap or rewrite.
- No change to the safety checks that refuse by default.
- No spending, launch, live payments or real data without owner approval.
