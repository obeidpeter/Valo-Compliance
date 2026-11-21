# P0 persistence slice — measured, not accepted

## Implemented

Next.js 15.5.29, React 19.2.9, TypeScript strict checking, Tailwind, Express,
PostgreSQL/Drizzle and managed Clerk wiring. The original preferred stack was
retained. Canonical user-authored draft content is saved with SHA-256 bindings,
append-only application revision history and expected-revision concurrency checks.

## Observed checks

- `pnpm run typecheck`: passed across all workspace packages.
- `pnpm --filter @workspace/valo run build`: passed with a dynamic App Router route.
- `pnpm --filter @workspace/scripts test:valo`: 52 foundation unit tests passed after full specification intake.
- API validation checks: all 37 locations, unknown/unanswered/not-applicable/zero
  distinction, declined marketing, strict input boundaries, invalid and reversed
  dates, duplicate sections, arbitrary clause/HTML node rejection, integer revisions
  and explicit enquiry consent passed.
- Development PostgreSQL integration: repeat membership resolution, separate tenant
  profiles/drafts, foreign-identifier read/write/revision rejection, two concurrent
  saves producing one successful revision and one 409, historical hash preservation,
  restore-as-new-revision, durable ticket reference and suspended membership passed.
- Actual development HTTP probes returned an empty released catalogue with 40 held
  templates, factual 127/127 requirement receipt, 186 held content-trace rows, P0/R2/live-payment false, 401 for an
  unauthenticated workspace read and 403 for a cross-origin mutation.
- Desktop homepage screenshot rendered the required brand/headline and both product
  journeys. This screenshot does not verify interactions or any signed-in screen.

## Not claimed

No formal requirement is accepted by this report. These tests are NOT the formal
80-rule, 60-customer-AI or 60-editorial suites. They do not prove verified managed
login/recovery, staff MFA, customer AI, source retrieval/review/publication, 12 guided
templates, exports, workers, private storage, backup/restore, payments, accessibility,
load or independent security/privacy/beta gates. P0 and R1 remain unpassed; R2 locked.

The synthetic database tests call the persistence layer with synthetic actor IDs.
This is explicitly not proof of Clerk identity/session verification. The anonymous
HTTP probes exercise the deployed development middleware without an auth bypass.

The local CI workflow now includes API input-safety tests, the Next.js build and a
separate ephemeral PostgreSQL migration/isolation job. It has not been uploaded:
GitHub metadata unexpectedly reported public visibility. Defining a job is not a
passing run. Remote results must be observed against their exact source commit after
private visibility is restored. No new app source was uploaded while public.
