# Valo Compliance — Valo Platform

Latest increment: real private source collection and exact final specification
intake. See [part 6 evidence and limits](docs/valo/part6-sources-and-retention.md).
All 24 reference links were attempted; 17 yielded privately retained raw/text
snapshots. None is approved, AI reviewed or published by retrieval alone.
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

## Not yet implemented or proven

The initial application is implemented, not a static mockup. Local database tests passed isolation, stale-write/concurrency, version preservation, profile consent and durable ticket checks. Anonymous HTTP tests reject private access and cross-origin mutation. These checks do not prove the managed signed-in browser journey.

Verified customer sign-in/recovery/expired-link/revoked-session browser tests, staff MFA, production export/worker compatibility, actual server AI/editorial publication, the source-backed checker, sandbox commerce and disaster recovery remain incomplete or unproved. The editor creates **user-authored business drafts**, not released baseline templates. Development exports require deliberate incomplete-draft acknowledgement and show actual queue states. No content is labelled AI-reviewed without real runs.

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
# Development database only; creates and removes UUID-scoped synthetic test records:
VALO_RUN_DB_TESTS=synthetic-development-only pnpm --filter @workspace/api-server test:valo-db
# Running Replit development preview only, anonymous safety/status checks:
VALO_RUN_HTTP_TESTS=synthetic-development-only pnpm --filter @workspace/api-server test:valo-http
# Actual development storage, renderer and separate-process worker tests:
VALO_RUN_EXPORT_TESTS=synthetic-development-only NODE_ENV=development pnpm --filter @workspace/api-server test:valo-exports
pnpm --filter @workspace/valo run build
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

The intended repository is `obeidpeter/Valo-Compliance` and is required to remain **private**. It was initially verified private, but the latest metadata observation returned `private=false`. **New application-source synchronization is paused; no visibility change was performed.** Restore private visibility before uploading the current Replit source. The existing draft pull request contains earlier foundation work and the coordinating team's specification baseline, not this latest application batch. Complete current source and tests remain in Replit.

**Main-branch protection enforcement is blocked under the current private-repository account plan**, as reported by the repository owner. A saved rule is not enforced protection. Do not claim main is protected, upgrade or transfer the repository, make it public, force-push, delete branches or bypass review.

After secure GitHub reconnection, the previously rejected workflow-file write succeeded. Earlier foundation CI is active remotely. The activation commit's push and pull-request runs both passed dependency installation, full typechecking, foundation tests and the readiness report. Actual historical run identifiers, source commit and step results are preserved in [CI evidence](docs/valo/evidence/ci-activation.json). Expanded API/Next.js/PostgreSQL CI is prepared locally but not uploaded or executed remotely while visibility is public.

CI check names must only be added as requirements after actual checks exist. Even then, account-plan restrictions may prevent enforcement. No protection setting or required-check configuration has been changed. Foundation CI is not evidence of P0 acceptance.
