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
| Linter | done with oxlint instead of ESLint, whose TypeScript parser and Next.js plugin depend on `picomatch` (decision 0009). It runs with type information in `pnpm run lint` and CI: correctness and suspicious rules, promises nobody awaits, the rules of hooks, Next.js and accessibility. Rules turned off and every inline exception give their reason. |
| TypeScript: strictFunctionTypes, noUnusedLocals/Parameters, noImplicitOverride | done |
| TypeScript: exactOptionalPropertyTypes, noUncheckedIndexedAccess (825) | exactOptionalPropertyTypes is on for every package except `lib/valo-core`, where `checker-business-name.ts` needs two edits and its bytes are bound to its recorded evaluation; it turns on there with the checker's next evaluation. noUncheckedIndexedAccess is on for every package, set once in `tsconfig.base.json`; the libraries' exported types are unchanged. In the API, a row a statement is certain to return goes through `singleRow` (`src/platform/rows.ts`), which fails loudly if it is ever missing; other guarded reads say so with `!`, and tests narrow with `assert.ok` |
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
| Move API code into `platform/` and `modules/` with public entry files | in progress: `modules/ai` holds the finite inference core, `modules/ai-lanes` the customer AI and operational review lanes, the history loader and the work-binding checks that run through it (decision 0013), `modules/commerce` the purchases, payments, receipts, refunds, payment concerns, disputes and Paystack contract, and `modules/rules` the rule registry and saved assessments, `modules/catalogue` the catalogue, released content and saved templates, `modules/exports` the document exports, their queue, recovery and retention, `modules/privacy` the privacy requests, erasure, private copies, data download and workspace data export, `modules/staff` staff authority, role administration and the staff areas' operations summaries, `modules/tasks` the tasks and reminders, `modules/support` the support lifecycle, and the editorial code is `modules/sources`, `modules/publication` and `modules/editorial`, which depend on one another in one direction and load the database client only when a function queries it ([architecture](README.md)), each behind its `index.ts`, and the repository rules checker rejects product code that imports a module's other files (`module-boundary`). Still in `src/lib`: the store (`valo-store.ts`), which holds what the target layout splits into identity, workspaces and documents; decision 0012 proposes the split and waits for the owner's review; and the recovery and operations helpers. The shared infrastructure is in `platform/`: settings, the workspace context and session checks, logging, error replies, request limits, the runtime and readiness guards, worker health and private storage |
| Remove the three import cycles | done: the last ran through the inference dispatcher, which loaded its work-binding checks and through them the callers that call it. The operator commands that run approved work now hand the dispatcher those checks (`provideFiniteWorkBindings`), and the repository rules checker rejects any import cycle and any unreviewed caller of that function (`inference-bindings`) |
| Every client-facing route in the API contract | done (the staff MFA check was the last one missing; the Paystack webhook faces the provider and stays outside the client contract) |
| Split the API contract per module | done: `lib/api-spec/src` holds one file per module, named after the target modules, with `base.yaml` for the header and the shared responses and `shared.yaml` for the schemas several modules use. `bundle.mjs` joins them into `openapi.yaml`, which code generation and the tests still read, and refuses a path or schema defined twice, a reference to nothing, a schema nothing uses and a schema in the wrong file. CI fails when `openapi.yaml` or the generated clients are not what the sources build |
| Worker loop becomes scheduled queue jobs | done in development: the seven operational tasks (source checks, reminders, payment events, refunds, disputes, dispute actions, payment reconciliation) are each a job on `valo-operations-v1`, scheduled every minute by the reviewed development queue setup. The queue allows one queued and one active job per task, so a slow task never piles up or holds back another, a failed run stays visible as a failed job, and with several workers each task still runs once a minute. The worker's loop keeps the export outbox and its health probes; its queue check refuses to run without the queue and its schedules. Production runs none of these tasks and has no such queue |
| Separate product logic from requirement/evidence bookkeeping in `valo-core` | done: the requirement records, the traceability and readiness report, the evidence links, the acceptance work items and the handover checkpoint moved to `lib/valo-records` (`@workspace/valo-records`), which depends on `valo-core` and never the other way. The register generators write there. The API reads it only for the public and development status routes and the source register's handover summary, and the web app does not depend on it. The content inventory and catalogue stay in `valo-core`, because the product reads them |
| Branch coverage of payments, sign-in and rules (NFR-011) | done as Node measures it: the database job runs each area's tests with Node's coverage and fails an area below 80% of branches; each run's figures are in its run summary and readiness report. The first hosted run (639db48) measured payment 84.79%, sign-in 91.45% and rules 88.41%. Node counts V8 blocks, so a function no test calls is one uncovered branch, and its figures can be higher than those of a tool that counts every branch. NFR-011 also asks for scenario tests, and a percentage never stands in for negative security cases |

Exit: CI forbids reaching inside another module; payments, sign-in and rules
reach the 80% branch coverage NFR-011 requires.

### Phase 3 — Data layer

| Item | Status |
| --- | --- |
| Regenerate schema snapshots; timestamp-named migrations; CI fails on schema changes without a migration | done |
| Automatic cross-workspace route tests (SEC-001) | done in CI (`valo-tenant-substitution.integration.test.ts`), each part with a guard that fails on anything new and uncovered. Identifiers in paths: the 32 private operations that take a workspace-owned identifier in their path are tried by another workspace, whose reply must equal the reply for an unknown identifier while the owner's rows stay unchanged; four take public catalogue identifiers, for recorded reasons, and the template file purchase check has its own isolation test. Identifiers elsewhere: the 18 identifier fields private operations take in their body, query string or headers are read from the schemas the API validates requests with; three name the workspace's own records and are tried the same way (a document revision, an assessment and the data-export list cursor), nine are client-chosen request keys whose unique indexes the test checks are scoped to the workspace, and six name nothing a workspace owns, for recorded reasons. Listings: all 17 private reads without an identifier show another workspace none of the owner's records. Entity types: each of the 45 tables that row-level security limits to one workspace, read from the database, is mapped to the cases that try its identifiers or to the reason no customer request names one of its rows. Background work is covered by the workspace-scope job tests and public search by the WEB-003 test. Passing tests are evidence, not acceptance |
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
| Measure request, search and export times (NFR-003, NFR-004) | done in CI: the database job sends 20 requests a second for 60 seconds, on a fixed schedule, through the real app on PostgreSQL (reads and saves of a business's own records, and catalogue searches signed in and anonymous) and fails if either kind's p95 exceeds one second or 1% fail on the server; the requirement's 30-minute run is the same test with `VALO_LOAD_SECONDS=1800`, which `pnpm test:db` passes through. It then exports a document of two to ten pages five at a time, four rounds per format, through the real export worker, and fails if DOCX p95 exceeds 10 seconds or PDF p95 30 seconds, counting the time in the queue. Each run's figures are in its summary. Finding: the export worker takes one job at a time and polls every second, so a job waits about a second for each job ahead of it while rendering takes well under a second. Five export slots would use the renderer's five-PDF limit, but the worker shares the pool's ten database connections with seven operations slots, so that change needs a connection budget first. The AI draft target (p95 ≤45s) needs real provider calls and is not measured |
| Server-rendered public pages, split bundle, self-hosted fonts | in progress: the three fonts are served from the app (`src/fonts.css`, OFL files from Fontsource), so no visitor request goes to Google, and the content security policy allows fonts and styles from the app's own origin only; the bundle is split, so each screen is its own chunk and a public page downloads the app shell and its own screen instead of the whole workspace and staff app: the app chunk fell from 552 KB to 242 KB (136 KB to 73 KB compressed), and in a local run of the NFR-002 lab check the pages' LCP fell from 3.5–3.7 seconds to 2.8–3.2 seconds, with INP and CLS unchanged. Server-rendered public pages are not started, and they are still needed: on an emulated mid-range phone over slow 4G, every public page the lab check measures still misses the 2.5-second LCP target, because each renders in the browser only after its scripts download. The LCP check is a todo test until server-rendered public pages land; the home page, which waits for the identity provider's script, and real-user measurements need a deployed instance. Decision 0011 proposes how to build them: each public page becomes its own server-rendered route, fed by the public API without the visitor's identity. It waits for the owner's review, and nothing in it is built |

### Phase 5 — Environments and operations

| Item | Status |
| --- | --- |
| Container images (API, web) built and start-checked in CI; environment profiles documented | done |
| Release and rollback procedure | done ([release-and-rollback.md](../valo/release-and-rollback.md)) |
| Alert definitions in one place | done (catalogue of the existing internal and external alerts). Every internal alert names its runbook and accountable roles (NFR-010), and the probes count security signals: repeated refusals, signature failures, staff role changes and callers at a quota limit (SEC-008, development thresholds) |
| Availability measure and synthetic checks (NFR-001) | built, not running: a proposed definition ([availability.md](../valo/availability.md)) with its denominator, planned-maintenance rule and separate AI and payment provider figures; the monthly calculation and its tests; and a runner that checks the public core journeys once. Where the checks run, where their results and the incident log are kept, and whether a synthetic account may check signed-in journeys are owner decisions |
| External error tracking and metrics service | blocked (a new dependency and a new processor of operational data; needs owner approval) |
| Backup retention policy (backups are never pruned today) | blocked (35-day policy proposed with a tested dry-run planner; nothing is removed until the owner approves it) |
| Staging and production environments | blocked (needs spend approval) |

### Phase 6 — Content operations

| Item | Status |
| --- | --- |
| Publish path from passing reviews to published versions | in progress for templates, blocked for guidance. Templates: seventeen templates have candidate preparers. Under [decision 0014](decisions/0014-publish-reviewed-pairs.md) (accepted), `prepareOperationalCandidateRelease` keeps a candidate that passes its checks as a private artifact awaiting its two reviews, and saves and holds one that fails. The finite manifest binds that artifact; the reviews run only inside an approved finite AI allocation. `publish-reviewed-pair.ts` checks each review against the batch's settled ledger entry, the candidate, plan and evidence, saves the version with its reviews, and hands it to the publisher (`publishOperationalVersion`), which rechecks every gate (policy, provenance, rights, mechanical checks, two independent passing reviews bound to the candidate, enhanced checks, exports and source bindings); a failed gate records the hold. TPL-07's one-step path (`prepareInventoryRelease`) is unchanged. The command has published only synthetic reviews in a disposable database; real content needs the AI spend approval. Guidance: the regulatory pipeline (`editorial/pipeline.ts`) holds every output with six standing reasons (`mandatoryDevelopmentHolds`), each waiting for an owner decision or outside evidence: an approved publication policy, verified current amendments and effective dates, a cleared rights record, an accepted claim scope, validated DOCX and PDF samples, and isolated publisher service credentials |
| Rule release path through the editorial gates | done in development (ADM-004): `src/scripts/rule-release.ts` plans a rule version against the registry and saved profiles (condition, next version, critical regression scenarios, preview of changed results) and applies it only with the operator's confirming manifest hash. It applies the registry's own admission check, reads each source's stored text before its transaction, then binds the sources to their current captures and supersedes the previous version inside it. A prior version is restored by releasing it again as the next one. Nothing produces real release requests yet: that needs the regulatory editorial pipeline, whose reviews are AI runs |
| Owner approval command for the AI budget | done in development: `src/scripts/finite-allocation-approval.ts` prepares the current finite package, records the owner's approval of that exact package for at most 24 hours and revokes it ([operating runbook](../valo/operating-runbooks.md)). Only one approval is current at a time, and the approval is kept only if the dispatcher's own admission check accepts it. A database test approves synthetic packages in an isolated schema; no approval exists, and running the command is the owner's spending decision. The package the 14 November decision packet names predates the clarified allocation boundary and is refused |
| Editorial staff screen, high-risk checks, source monitoring, user notices | in progress. The staff Content area (ported with PR 29) lists content and rule versions with their status, review date and safety holds, the daily source checks and the correction review queue, and lets content staff hold or withdraw a version or start watching an official source. Each version now opens its publication record (ADM-002): what its stored bundle passes or holds on now and why, the drafting and review runs with their models, run IDs, verdicts and findings, its check counts, safety holds and publication audit; reading it needs the content role and fresh MFA and is recorded. User notices: detail pages show the source-check and review dates, the AI-review disclosure, scope and limitations (EDP-008), and customers see correction notices. High-risk checks: the publication gate requires five enhanced checks (controlling text, amendments, effective dates, exceptions, jurisdiction) for every item that is not general. Under decision 0014 the two AI reviews of such an item answer each check with the passage they relied on, and a check passes only when both pass it with a passage found in the candidate or its sources; the publisher derives them again from the attested reviews. They are AI checks, not legal, tax or regulatory review. No preparer yet produces content that is not general, so none has run on real content. The staff Content area also lists the templates awaiting their reviews, from their own records (`valo_prepared_candidates`), with where each stands: awaiting its reviews, saved, past its review date, or overtaken by another candidate saved under its version number |
| Acceptance suites against the live engine | not started |

## What this plan does not do

- No microservices, framework swap or rewrite.
- No change to the safety checks that refuse by default.
- No spending, launch, live payments or real data without owner approval.
