# Valo Compliance — Valo Platform

Latest increment: the documentation checkpoint was merged with normal history,
and development schema changes now fail closed on reported SQL errors. See
[the checkpoint and executed evidence](docs/valo/handover-checkpoint.md).
The previous [official PDF ingestion evidence](docs/valo/coordinating-refinement.md) remains retained.
The original 24 references remain intact, with four distinct additional source
leads. Nineteen sources now have privately retained raw/text snapshots, including
the 27,677,259-byte NRS Act and the CAC Gazette PDF. None is approved, AI reviewed
or published by retrieval alone.
Proposed retention periods remain unapproved and unenforced.

Valo is being built for Nigerian SMEs to create business documents and understand source-backed business obligations.

**Status: early R1/P0 implementation. Not launched; P0 has not passed.**

## Implemented source in this branch

- Framework-independent editorial eligibility validation with strict schemas, candidate/source/policy/review/test/export bindings and fail-closed holds.
- Verbatim traceability for all 127 formal requirements, checked against the coordinating team's retained complete TRD extract. Earlier bounded transfers are compared for conflicts rather than replaced silently. All requirements remain unaccepted.
- Metadata for the original 40-template baseline and 19 provisional additional candidates. All templates are held; zero published templates.
- Requirements, content, conflict and platform-source research registers.
- Executable foundation unit tests and a machine-readable readiness report.
- A running Next.js/TypeScript/Tailwind application with Valo's public development pages, branded managed Clerk screens, a private workspace, versioned business-profile form, canonical manual draft editor, preview, revision history, undo and conflict-aware autosave.
- PostgreSQL/Drizzle persistence and a tracked migration for memberships, business-profile versions, document revisions, support tickets and metadata-only activity events.
- Server-validated Clerk identity, active-session and verified-primary-email checks; application-resolved tenant membership; same-origin JSON mutation checks and private no-store responses.
- A development-only live requirements/conflict dashboard at `/development`, with exact criteria and honest blocked states.
- The same dashboard exposes UAT-01–10, original G0–G5 evidence/approver roles and non-waivable launch blockers. All remain unaccepted.
- PostgreSQL-backed read quotas with keyed pseudonyms, atomic concurrent caps and request-driven expiry. Production end-user IP resolution and abuse alerting remain unproved; this is partial SEC-005.
- Complete specification extracts and the coordinating team's registers under `docs/specification/` and `docs/registers/`. All 27 supplementary document mappings and 79 regulatory research rows are retained. Five direct matches, one composite and 21 additions give 61 identified templates; 19 distinct-purpose proposals bring the backlog to 80, not 80 published assets. NGO SCUML remains an alias.
- Public industry discovery and library filters now use all 20 exact taxonomy categories. Six deeper-pack targets, location/source gaps and NGO cautions are explicit; no checked dates or released guidance are invented.
- Development-only private DOCX/Chromium PDF exports from saved manual revisions, a durable pg-boss worker, transactionally recorded requests, bounded retries and checksum-verified App Storage files. Exact engineering context is retained separately without inflating the 127 formal requirements.
- All 27 supplementary mappings match the coordinating refinement; all 13 original conflict resolutions and 14 attributed discovery observations are retained separately from actual local retrieval. The dashboard shows local outcomes, private checksums, metadata/title conflicts and publication holds.

## Not yet implemented or proven

The initial application is implemented, not a static mockup. Local database tests passed isolation, stale-write/concurrency, version preservation, profile consent and durable ticket checks. Eleven actual managed-development browser checks now also pass: signup/test verification, profile persistence, saved drafts, real private DOCX/PDF downloads, two-business isolation, concurrent tabs, revision restore, new-browser sign-in, session revocation and logout. See [customer journey execution](docs/valo/customer-journey-proof.md). Development test codes do not prove real email delivery.

Password recovery, expired links, suspended accounts, staff MFA, production identity/export/worker compatibility, eligible editorial publication, the source-backed checker, sandbox commerce and disaster recovery remain incomplete or unproved. Actual server editorial drafting and separate factual/challenge calls ran; deterministic source/locator failures held the candidate. The editor creates **user-authored business drafts**, not released baseline templates. Development exports require deliberate incomplete-draft acknowledgement and show actual queue states. Document revision restoration is not database disaster recovery.

The separate **80-rule**, **60-customer-AI** and **60-editorial** acceptance suites remain unexecuted. Foundation tests do not count toward those suites. No R1 gate is accepted and R2 is locked. R3 is excluded.

## Development checks

Use Node.js 22 or newer and pnpm 10.26.1.

```sh
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/scripts test:valo
pnpm --filter @workspace/scripts valo:readiness
pnpm --filter @workspace/api-server test:valo
pnpm --filter @workspace/db test:schema-guard
# Development database only; creates and removes UUID-scoped synthetic test records:
VALO_RUN_DB_TESTS=synthetic-development-only pnpm --filter @workspace/api-server test:valo-db
# Running Replit development preview only, anonymous safety/status checks:
VALO_RUN_HTTP_TESTS=synthetic-development-only pnpm --filter @workspace/api-server test:valo-http
# Actual development storage, renderer and separate-process worker tests:
VALO_RUN_EXPORT_TESTS=synthetic-development-only NODE_ENV=development pnpm --filter @workspace/api-server test:valo-exports
pnpm --filter @workspace/valo run build
# Explicit development-only source collection / private storage tests:
NODE_ENV=development VALO_RUN_SOURCE_RETRIEVAL=official-development-only pnpm --filter @workspace/api-server sources:retrieve-instruments
NODE_ENV=development VALO_RUN_SOURCE_TESTS=official-development-only pnpm --filter @workspace/api-server exec tsx --test src/editorial/source-instruments.integration.test.ts src/editorial/source-store.integration.test.ts
```

No credential values belong in source or GitHub Actions. Foundation checks require no provider secrets or production access. See [implementation evidence](docs/valo/README.md), [compatibility findings](docs/valo/compatibility.md) and [evaluation boundaries](docs/valo/evaluations.md).

The latest bounded development increment is documented in
[part 5 architecture and exports](docs/valo/part5-architecture-and-exports.md), with actual
commands, outputs and source hashes in its linked evidence record. Earlier CI passes
do not certify this unuploaded batch.

## Release restrictions

Public launch, live payments, recurring billing, real confidential customer data and new paid hosting/subscription commitments remain disabled pending the required approvals. Use synthetic development data and sandbox transactions only.

The preferred application stack remains Next.js, TypeScript, Tailwind, PostgreSQL/Drizzle, Clerk, private storage, separate pg-boss workers, DOCX/Chromium PDF, Paystack hosted sandbox checkout, email and server AI. The artifact bootstrap was adapted to Next.js, not substituted for Vite. Next.js strict typechecking, production build and proxied development serving pass locally. Production serving is configured as a server rather than a static Vite export; deployment, worker, storage and recovery compatibility are not yet proven.

## Repository safeguards

The intended repository is `obeidpeter/Valo-Compliance` and is required to remain **private**. Authenticated and unsigned GitHub reads initially confirmed public access. The existing authorized connection corrected this exact repository to private; fresh verification returned `private=true` and unsigned HTTP 404. See [privacy correction evidence](docs/valo/evidence/p0-github-privacy-correction.json). This does not retract earlier public copies. Source-transfer and CI status require their own commit-bound readback, not an inferred success.

The documentation checkpoint is commit `871899483093363ec69d765e2d16fa1d88e0836e` on `docs/specification-baseline`, with open draft PR [#1](https://github.com/obeidpeter/Valo-Compliance/pull/1). These facts were read back through authorised access; main contained only `README.md`. The baseline and application have separate Git roots and are being joined without rewriting either history. The specification/register files match the local copies byte for byte.

**Main-protection enforcement remains unverified/blocked.** The handover reports an unenforced saved policy under the account plan; it is not evidence of protected main. Historical CI records do not prove a newer commit passed. Source-transfer and CI claims must identify the actual remote commit and readback; local test success alone is insufficient. Do not upgrade, transfer, make public, force-push, delete history or bypass review.

CI check names must only be added as requirements after actual checks exist. Even then, account-plan restrictions may prevent enforcement. No protection setting or required-check configuration has been changed. Foundation CI is not evidence of P0 acceptance.

Development schema changes now use a fail-closed wrapper. It rejects production,
unacknowledged changes and force arguments; SQL errors cannot become success
merely because Drizzle exits zero. A clean command must also pass non-skipped
application database postcondition tests. See [schema safety](docs/valo/schema-safety.md).
The historical partial migration, production schema/queue grants and restore
remain unaccepted.
