# Valo Compliance — Valo Platform

Valo helps Nigerian small businesses create business documents and understand
the regulatory requirements that may apply to them, with every requirement
traced to an official source. This repository builds releases R1 and R2 of the
product described in [`docs/specification`](docs/specification).

**Status: in development. Not launched.** No content is published, live
payments are off and no real customer data is processed. The current, generated
status is in [`docs/status.md`](docs/status.md).

## Getting started

Requirements: Node.js 24 (see `.node-version`), pnpm 10.26.1, PostgreSQL 16.

```sh
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/scripts test:valo
pnpm --filter @workspace/api-server test:valo
```

Run the applications (development only):

```sh
pnpm --filter @workspace/api-server run dev   # API on $PORT
pnpm --filter @workspace/valo run dev         # web app on $PORT
pnpm --filter @workspace/api-server run worker:dev
```

The API needs `DATABASE_URL`, `SESSION_SECRET` (32+ characters), Clerk keys and
`VALO_TRUSTED_ORIGIN`. Database, browser and recovery test groups, and the
environment each needs, are listed in
[`.github/workflows/valo-foundation.yml`](.github/workflows/valo-foundation.yml).

## Repository map

| Path | Contents |
| --- | --- |
| `artifacts/valo` | Next.js web app: public site and private workspace |
| `artifacts/api-server` | Express API, background worker, operator commands |
| `lib/db` | Database schema and append-only SQL migrations |
| `lib/api-spec` | OpenAPI contract (source of the generated `lib/api-zod` and `lib/api-client-react`) |
| `lib/valo-core` | Logic shared by the API and web app |
| `scripts`, `scripts/ops` | Registers, readiness report, security scans; backup, restore and release tooling |
| `docs/specification` | The original brief, technical requirements and roadmap |
| `docs/registers` | Requirements traceability, content inventory, conflicts and decisions |
| `docs/architecture` | Architecture overview, change plan and decision records |
| `docs/valo` | Runbooks, checkpoints and retained evidence |

## How work is done here

Read [`AGENTS.md`](AGENTS.md) first. It covers the approvals that must never be
assumed, honesty rules for status and content, the branch workflow, database
migration rules and the files that must not change.

- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md)
- Change plan and progress: [`docs/architecture/plan.md`](docs/architecture/plan.md)
- Operations: [`docs/valo/operating-runbooks.md`](docs/valo/operating-runbooks.md)
- Owner decisions still open: [`docs/reviews/external-completion-decisions-2026-11-14.md`](docs/reviews/external-completion-decisions-2026-11-14.md)
- Earlier checkpoint log: [`docs/valo/history/readme-checkpoint-log-2026-11-16.md`](docs/valo/history/readme-checkpoint-log-2026-11-16.md)

## Release restrictions

Public launch, live payments, recurring billing, real confidential customer data
and new paid hosting or subscriptions stay disabled until the product owner
approves them. Development uses synthetic data and sandbox transactions only.

## Repository safeguards

The repository must stay private. `main` is the release branch and holds only
the initial commit; `feature/valo-p0-foundation` is the integration branch.
Do not change visibility, force-push, delete history or bypass review.
