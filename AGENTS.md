# Working on Valo — rules for coding agents and contributors

Valo is a platform for Nigerian SMEs: business document templates plus
source-backed regulatory guidance. This repository builds releases R1 and R2.
R3 is excluded. Read this file before changing anything.

## 1. Approvals you must never assume

These need explicit, current approval from the product owner. A request to
"build", "fix" or "implement" something is not approval for any of them.

- Spending money: paid plans, hosting, provider usage, AI inference budgets.
- Live payments, real merchant actions, refunds or disputes against real money.
- Public launch, opening production traffic, or deploying to production.
- Processing real customer or confidential data.
- Sending real external messages (email, notifications) to anyone.
- Changing repository visibility, branch protection, plans or account settings.
- Merging into `main`, force-pushing, rewriting or deleting shared history.

If work is blocked on one of these, finish everything else and state exactly
what decision or credential is needed.

## 2. Honesty rules

- Never describe something as done, published, accepted or verified unless the
  code exists and a real check proves it. Say "implemented", "tested" and
  "accepted" only in their literal sense.
- Requirement IDs and acceptance text in `docs/specification` and
  `docs/registers` are the contract. Preserve them verbatim. Never infer
  acceptance from inventory, a filename, a fixture or an AI model's verdict.
- AI review is not professional legal, tax or regulatory review. Never label it
  as such in code, content or docs.
- Keep held content held. Templates, guidance and rules publish only through
  the editorial gates. Never seed, forge or hand-insert published rows.
- When a test fails, fix the cause. Never weaken an assertion, skip a test or
  loosen a safety check to make a run pass.

## 3. Repository workflow

- `main` is the release branch and only holds the initial commit today.
- `feature/valo-p0-foundation` is the integration branch. Work happens on
  feature branches with pull requests into it.
- Before adding a database migration, check the integration branch and open
  pull requests for the next free number (see section 6).
- Keep pull requests focused. Moving code and changing behaviour belong in
  separate commits.

## 4. Code organisation

See `docs/architecture/README.md` for the full picture and the target module
layout. In short:

| Path | Purpose |
| --- | --- |
| `artifacts/valo` | Next.js web app (public site and private workspace) |
| `artifacts/api-server` | Express API, background worker, operator commands |
| `lib/db` | Drizzle schema, SQL migrations, guarded schema tooling |
| `lib/api-spec` | OpenAPI contract; generates `lib/api-zod` and `lib/api-client-react` |
| `lib/valo-core` | Business logic shared by the API and web app |
| `lib/valo-records` | Requirement records, traceability and evidence bookkeeping |
| `scripts/` | Requirement registers, readiness report, security scans |
| `scripts/ops/` | Backup, restore, release and host supervision tooling |
| `docs/` | Specification, registers, architecture, runbooks, evidence |

Rules that apply now:

- Change the API contract in its module's file in `lib/api-spec/src`, then run
  `pnpm --filter @workspace/api-spec run codegen`, which rebuilds
  `lib/api-spec/openapi.yaml` and the clients. A schema lives in the file of the one
  module that uses it, or in `shared.yaml` when several do; the build refuses anything
  else. Never edit generated files.
- Validate all request input with the generated Zod schemas.
- An empty `catch` or `.catch(() => {})` needs a comment saying why the error is
  ignored. Prefer logging it. Import cycles fail CI, type-only and lazy imports
  included.
- oxlint checks the code with type information (`.oxlintrc.json`). A promise
  nobody awaits is handled or marked with `void`. An exception names the rule
  and says why: `// oxlint-disable-next-line <plugin>/<rule> -- <reason>`; one that
  suppresses nothing fails the run. Change which rules run only in `.oxlintrc.json`,
  with the reason beside the rule.
- Run `pnpm run format` before committing; CI rejects unformatted code.
- Domain failures throw `ValoProblem` with a safe customer message. Never put
  private data in error messages or logs.
- Every customer query is scoped to the server-resolved workspace. Never accept
  a workspace, role or identity from the browser. Services take a
  `WorkspaceActor`, which only `resolveWorkspace` and `workspaceActorFromRecord`
  (never in HTTP code) can create; the `workspace-actor` repository rule
  enforces this.
- Never hold a transaction, lock or pooled database connection while waiting on
  an AI model, payment provider or other external service. Check pauses and
  holds just before the call, and recheck them in the transaction that saves its
  result. Inside a transaction, use only that transaction's connection. The CI
  database job fails when any test takes a second pooled connection inside a
  transaction; the reviewed exceptions are listed in
  `artifacts/api-server/src/test-support/nested-connection-report.mjs`.
- Customer requests run in their workspace's database scope: the identity
  middleware calls `runInWorkspaceScope`, their connections log in as
  `valo_workspace_login` (`VALO_CUSTOMER_DATABASE_URL`), each transaction carries
  a credential the application signs for that transaction alone, and row-level
  security limits every query to the workspace's rows. Keep the workspace filters
  too. Only the identity middleware and the reviewed jobs in `WORKSPACE_SCOPE_ENTRIES`
  may call `runInWorkspaceScope`: the middleware with the workspace it resolved from
  the membership, a background job for one workspace with the workspace of the stored
  record it processes, reading that workspace's data in the scope and keeping its
  bookkeeping outside. Never give the login or the scoped role another privilege or
  membership outside a reviewed migration, and in customer code never change the
  role, `search_path` or `valo.workspace_credential`, or use session-level `SET`
  (use `SET LOCAL`). A customer
  request cannot see other workspaces' rows, so a total it needs across
  workspaces (such as a shared limit) comes from a reviewed database function
  that returns only that total, like `valo_customer_ai_reservations`. The shared
  inference ledger is written only through its functions
  (`valo_inference_budget_commit` and the others in decision 0008).
- Only the operator commands in `FINITE_WORK_BINDING_ENTRIES` hand the inference
  dispatcher its work-binding checks (`provideFiniteWorkBindings`), and only the real
  `assertFiniteWorkBindings`; the `inference-bindings` repository rule enforces this.
- API code is moving into one folder per capability under
  `artifacts/api-server/src/modules/`. Code outside a module imports it only through
  its `index.ts`; the `module-boundary` repository rule enforces this, and tests may
  import a module's files directly.

## 5. Checks

```sh
pnpm install --frozen-lockfile
pnpm test        # typecheck, lint (formatting, oxlint and repository rules), fast unit suites
pnpm test:db     # CI's database job, against a PostgreSQL cluster of its own
```

Database, browser and recovery groups are listed in
`.github/workflows/valo-foundation.yml`. `pnpm test:db` runs every step of the
`postgres` job from that file, in order, against a cluster it starts in a temporary
folder and removes afterwards (it needs PostgreSQL 16 installed and an ordinary,
non-root user). It never uses a database from your environment and passes the steps
none of your credentials. Add a database group to the workflow and it runs there too;
`--keep-going` reports every failing step. Every test file must be run by a package
script that CI calls; `scripts/src/valo/test-inventory.test.ts` fails otherwise,
unless the exception and its reason are recorded there. Tests create only
synthetic records and never call real providers. A green local run is not hosted CI; check the actual
workflow run for the exact commit before reporting CI status.

## 6. Database changes

- Migrations in `lib/db/drizzle` are append-only. Never edit, rename or delete a
  migration that has been merged into the integration branch.
- Change the Drizzle schema, then run
  `pnpm --filter @workspace/db exec drizzle-kit generate --name <change>`. New
  files are timestamp-named. For functions, triggers or grants use
  `drizzle-kit generate --custom --name <change>` and write the SQL by hand.
  CI fails if the schema changes without a migration (`test:schema-drift`).
- In hand-written SQL, give every primary key, unique constraint, foreign key,
  check constraint and index the name the latest snapshot in `lib/db/drizzle/meta`
  records, and declare each one in the Drizzle schema. Only a single-column primary key may
  keep PostgreSQL's own name (`<table>_pkey`), which is also Drizzle's. The
  migration tests fail on any difference.
- A table that holds workspace rows needs `workspaceRowPolicy` (or a policy
  through its parent row) in the schema, created in the same migration. The
  migration tests fail on any `workspace_id` table without it.
- The scoped role holds only the privileges in `WORKSPACE_SCOPE_PRIVILEGES`
  (`lib/db/scripts/workspace-row-security.mjs`), and new tables give it nothing.
  When customer requests start using a table, command or column, grant exactly
  that in the migration and add it to the list. Until then those requests fail
  with `permission denied`; the migration tests fail on any other difference.
- Extend `lib/db/scripts/phase1-migrations.test.mjs` with an upgrade check for
  every new migration. When two branches both add migrations, renumber the
  journal `idx` values on merge so they stay contiguous.
- The Replit development database has no migration ledger. New migrations are
  applied there one file at a time, following `docs/valo/phase1-migration-plan.md`.
  Never run the full migrator against it and never fabricate ledger rows.
- Schema push is guarded (`lib/db/scripts/schema-push.mjs`). Never bypass it.

## 7. Files that must not change

Tests verify these byte-for-byte or by hash:

- `docs/specification/*` and the handover-pinned files in `docs/registers/`.
- SQL migrations already merged into the integration branch.
- Existing evidence files in `docs/valo/evidence/` and frozen content in
  `docs/content-candidates/` and `docs/evaluation-candidates/`.

Do not add new evidence files to `docs/valo/evidence/`. Record run evidence as
CI artifacts and summarise it in the pull request. To count a test as evidence for a
requirement, cite it in `docs/registers/ci-evidence.json` with one sentence on what it
shows (decision 0010). CI fails when a cited test does not pass, and the `evidence`
job publishes the readiness report with each citation's result as `readiness-report`.
A citation never accepts a requirement.

## 8. Privacy and security defaults

- Synthetic data only. Test identities start with `synthetic-` or
  `privacy-fixture-`; erasure refuses anything else.
- The repository is public by owner decision (16 November 2026). Treat every
  commit as published: no secrets, credentials, real customer data or private
  business details in source, logs, tests, docs or commit messages.
  Configuration comes from the server secret store.
- Development-only features check the runtime with the existing guards
  (`assertDevelopmentRuntime`). Production mode serves only `/api/healthz`
  until a reviewed launch change exists.
