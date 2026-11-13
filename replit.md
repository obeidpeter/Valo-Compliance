# Valo Compliance

Valo is a Nigerian SME business-documentation and source-governed compliance application being implemented against R1, then gated R2. It is not yet release-ready.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server using the artifact-managed PORT
- `pnpm --filter @workspace/valo run dev` — run the Next.js frontend using the artifact-managed PORT
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Web: Next.js 15.5.29, React 19.2.9, TypeScript strict, Tailwind
- Identity: managed Clerk; application-owned memberships
- Validation: generated Zod 3 contracts and `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- API build: esbuild ESM; web build: Next.js server

## Where things live

- `artifacts/valo` — actual Next.js application
- `artifacts/api-server` — identity/tenant-scoped private API and persistence
- `lib/db/src/schema`, `lib/db/drizzle` — Drizzle schema and retained SQL migration
- `lib/api-spec/openapi.yaml` — source API contract
- `lib/valo-core` — fail-closed editorial validator and executable requirements/content registers
- `docs/specification`, `docs/registers` — complete coordinating-team specification baseline
- `docs/valo` — measured evidence, compatibility, limitations and operations notes

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

Visible brand: Valo. Required homepage copy: "The documents you need. The business rules you should know."

The initial Next.js application now has a database-backed profile, canonical manual draft editor, revision history, conflict-aware saves, durable support tickets and a live development requirements/content/conflict register. All 127 formal requirements and the 27/79 inventories are retained. No P0/R1 gate is passed, no template is published and no private export or real editorial pipeline is implemented. See `docs/valo/README.md` and its evidence links.

Run `pnpm --filter @workspace/scripts valo:readiness` for the current machine-readable register and `pnpm --filter @workspace/scripts test:valo` for foundation unit tests. Synthetic unit tests never count toward formal rule/customer-AI/editorial acceptance totals.

## User preferences

- Preserve all original requirement IDs and exact acceptance text; never infer acceptance from source inventory, a filename or a model verdict.
- R1 gates must pass before R2; R3 is excluded.
- No public launch, live payments, recurring billing, real confidential customer data, plan purchases or paid hosting commitments without explicit approvals.
- Use Next.js, TypeScript, Tailwind, PostgreSQL, Drizzle, Clerk, private storage, separate pg-boss workers, DOCX/Chromium PDF, Paystack sandbox, email and server AI unless the owner approves a documented alternative.
- Never label catalogue titles as published documents or synthetic fixtures as integration success.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

- GitHub metadata most recently reported the intended private repository as public. Keep new source in Replit until private visibility is restored; do not change visibility, plans or protection automatically.
- Browser auth uses Clerk cookies, never mobile-style explicit bearer-token handling. The signed-in UI has not yet been verified.
- A manual draft revision restore is not a backup/disaster-recovery drill.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
