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
| `scripts/` | Requirement registers, readiness report, security scans |
| `scripts/ops/` | Backup, restore, release and host supervision tooling |
| `docs/` | Specification, registers, architecture, runbooks, evidence |

Rules that apply now:

- Change the API contract in `lib/api-spec/openapi.yaml`, then run
  `pnpm --filter @workspace/api-spec run codegen`. Never edit generated files.
- Validate all request input with the generated Zod schemas.
- An empty `catch` or `.catch(() => {})` needs a comment saying why the error is
  ignored. Prefer logging it. New import cycles fail CI.
- Run `pnpm run format` before committing; CI rejects unformatted code.
- Domain failures throw `ValoProblem` with a safe customer message. Never put
  private data in error messages or logs.
- Every customer query is scoped to the server-resolved workspace. Never accept
  a workspace, role or identity from the browser.

## 5. Checks

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint        # formatting and repository rules
pnpm --filter @workspace/scripts test:valo
pnpm --filter @workspace/api-server test:valo
```

Database, browser and recovery groups are listed in
`.github/workflows/valo-foundation.yml`. Tests create only synthetic records and
never call real providers. A green local run is not hosted CI; check the actual
workflow run for the exact commit before reporting CI status.

## 6. Database changes

- Migrations in `lib/db/drizzle` are append-only. Never edit, rename or delete a
  migration that has been merged into the integration branch.
- Register every new migration in `lib/db/drizzle/meta/_journal.json` with the
  next index and a later timestamp, and extend
  `lib/db/scripts/phase1-migrations.test.mjs`.
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
CI artifacts and summarise it in the pull request.

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
