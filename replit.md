# Valo Compliance

Valo is a Nigerian SME business-documentation and source-governed compliance application being implemented against R1, then gated R2. It is not yet release-ready.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

Visible brand: Valo. Required homepage copy: "The documents you need. The business rules you should know."

Current work is the initial requirements/catalogue registers and a fail-closed editorial eligibility validator, not the completed application. See `docs/valo/README.md`, `docs/valo/compatibility.md` and `docs/valo/evidence/foundation-checks.md`.

Run `pnpm --filter @workspace/scripts valo:readiness` for the current machine-readable register and `pnpm --filter @workspace/scripts test:valo` for foundation unit tests. Synthetic unit tests never count toward formal rule/customer-AI/editorial acceptance totals.

## User preferences

- Preserve original requirement IDs and acceptance text; do not fabricate the missing portions of the 127-requirement TRD.
- R1 gates must pass before R2; R3 is excluded.
- No public launch, live payments, recurring billing, real confidential customer data, plan purchases or paid hosting commitments without explicit approvals.
- Use Next.js, TypeScript, Tailwind, PostgreSQL, Drizzle, Clerk, private storage, separate pg-boss workers, DOCX/Chromium PDF, Paystack sandbox, email and server AI unless the owner approves a documented alternative.
- Never label catalogue titles as published documents or synthetic fixtures as integration success.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
