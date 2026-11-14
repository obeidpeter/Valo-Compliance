# Valo Compliance — Valo Platform

## Latest development checkpoint — merge security and isolated recovery

Added merge-time dependency/secret/static checks, actual HTTP/error-log privacy
capture, internal development worker/database/backlog/cleanup/payment probes and
a disposable synthetic database/object restore drill. The drill replays access
tombstones/revocations; it does **not** complete physical privacy erasure or prove
production/App Storage recovery. The 35-day retention proposal remains unresolved.
The live development probe found 94 retained synthetic settled orders missing
receipt-outbox rows and kept an internal alert; no messages or money operations
were triggered. See [the exact scope and commands](docs/valo/merge-security-and-recovery.md).
Formal acceptance, R1/R2 and production approval remain incomplete.

## Previous checkpoint — export and account boundaries

Development exports, recovery, queue construction and worker dispatch now require
explicit development and no nonempty deployment marker. Account/session changes
abort old requests and clear copied forms, caches and toasts; native cross-tab
session-end messages and current API session loss also clear the private subtree.
Ordinary same-account profile navigation offers save/discard/stay.

Executed: **45 runtime-boundary controls**, **13 controlled browser checks**,
**62 development database tests**, **10 real development private-export tests**,
API **172 pass / 1 skip**, and workspace typecheck. The browser used actual
components with controlled identities/API responses, not new real Clerk
two-account acceptance. Positive exports used real PostgreSQL, App Storage,
DOCX/PDF rendering and worker restart; this is not production recovery proof.
The 127-row traceability refresh and its engineering suite also passed **166
checks**, preserving exact source requirements and unaccepted release gates.

See [the checkpoint and limitations](docs/valo/runtime-boundary-security-checkpoint.md)
and [exact source/log evidence](docs/valo/evidence/runtime-boundary-security-checkpoint.json).
R1/R2 remain incomplete and unaccepted. No spending, quota increase, content
release, public launch or live payments was enabled.

## Source challenges retained, not accepted rules

The original 80-case checker corpus is unchanged. The new exact-source-bound
run executed 80: **72 matched authored labels, eight disagreed**. All failures
remain visible. **112 engineering controls passed**, including ten focused
clarification controls; these are not 112 legal acceptance cases. No rule,
manifest, customer assessment, reminder or model call was created.

See the [source-challenge checkpoint](docs/valo/source-checker-challenge-checkpoint.md)
and [versioned actual results](docs/valo/evidence/source-checker-80-challenged-evaluation-v1.json).
Independent preparation is recorded separately from a formal provider receipt.
R1/R2 remain incomplete; inference/public launch/live payments remain off.

## Inference-budget checkpoint — held, not launch acceptance

The shared $30 managed-inference allocation is a **disabled proposal**, not
spending authority. New application model calls are held before outbound
dispatch; saved previews, private drafts/exports and manual editing remain
available. Earlier real-provider evidence is historical, not a claim that new
generation is currently enabled. Daily/identity limits were not increased.

See [the setup checklist and exact budget prerequisites](docs/valo/setup-and-disabled-inference-budget.md)
and [executed, source-bound evidence](docs/valo/evidence/inference-budget-checkpoint.json).
Current checks: API 172 pass / 1 skip; database 62 pass; controlled commerce 15,
refund lifecycle 17, refund adapter 5 and email/privacy controls 10 pass;
workspace typecheck and 19 isolated clean migrations pass. These are engineering
checks, **not** formal 80/60/60 acceptance. R1/R2 remain incomplete/unaccepted;
eligible publications/rules remain zero. Public launch/live payments stay off.

Existing development migration history remains unadopted: only the reviewed
additive budget delta was applied, without fabricating earlier journal entries.

Latest privacy checkpoint: [verified requests, staff operations and scoped private results](docs/valo/privacy-cases-checkpoint.md).
These are working partial processing flows, not completed erasure, provider-wide privacy fulfilment or accepted R1/R2.

Latest private-editor checkpoint: [twelve question-led drafts and verified private exports](docs/valo/guided-private-layouts-checkpoint.md).
These are personal draft forms, not released catalogue masters or accepted R1/R2.

Customer-support checkpoint: [complete message details and honest JSON export scope](docs/valo/support-privacy-scope-checkpoint.md).
This proves the narrowly described browser behaviour, not privacy fulfilment,
privileged staff/MFA acceptance or whole R1/R2 completion.

Latest checker checkpoint:
[all 80 supplied source cases executed, with 72 matches and eight retained oracle disagreements](docs/valo/source-checker-candidate-checkpoint.md).
The 102 passing candidate-control TAP records are not formal legal/rule acceptance.

Latest customer-journey checkpoint:
[customer edit safety, paginated task totals, reminder fairness and original receipt recovery](docs/valo/customer-safety-reliability-checkpoint.md).
This remains partial development, not full R1/R2 implementation or acceptance.
The forty-template/thirty-guidance content inputs are not thereby published;
the separate source-backed 80/60/60 acceptance suites and R1/R2 gates are not accepted.

Earlier implementation checkpoint:
[account-scoped component state and seven controlled browser regressions](docs/valo/account-state-checkpoint.md).

Earlier implementation checkpoint:
[amount-safe partial/full refund requests, fresh-MFA finance decisions and crash recovery](docs/valo/refund-lifecycle-checkpoint.md).

Earlier implementation checkpoint:
[separate AI instructions, preserved manual notes and two supplied cases through private exports](docs/valo/customer-ai-source-checkpoint.md).

Earlier implementation checkpoint:
[forty exact-ID draft bodies, measured review requests and crash-recoverable reminders](docs/valo/content-intake-reminder-checkpoint.md).

Previous implementation checkpoint:
[patched validation, exact-ID source intake and measured private exports](docs/valo/validator-publication-checkpoint.md).

This is partial development, not complete R1/R2 acceptance. No eligible content,
real merchant settlement, public launch or live payments are claimed.

Previous implementation checkpoint:
[export crash recovery, correct pagination and accessible/mobile editing](docs/valo/export-recovery-accessibility-checkpoint.md).

Earlier original-content adaptation and dependency repair checkpoint:
The [preceding ChatGPT permission/editorial checkpoint](docs/valo/chatgpt-permission-checkpoint.md) verifies the original prose's scoped provider permission without an invented paid-plan hold, binds server review evidence, and durably records quota failures. Four real review calls were retained; no candidate was published. This supersedes historical rights-status summaries only for the original ChatGPT route, not Replit/API authoring or commercial sales.

The [recorded-payment reminder customer slice](docs/valo/reminder-customer-checkpoint.md) now includes saved payment breakdowns, past original deadlines, genuine AI evidence, private exports and a managed-identity mobile/keyboard journey. It is a partial R1 implementation checkpoint, not full 80/60/60 acceptance.

The [compressed-request advisory regression](docs/valo/parser-regression-checkpoint.md) now retains named hostile-payload/liveness checks, exact installed versions and separate generator/runtime Undici inventory. This targeted result is not full security or release acceptance.

[working changes, actual export/storage proof and remaining implementation gaps](docs/valo/content-dependency-checkpoint.md).
The seven forms and other supplied content remain held; neither export checks nor dependency repairs constitute R1/R2 acceptance.

Previous customer routes, signed-out access support, privacy requests and staff-read checkpoint:
[working behavior, executed checks and remaining limitations](docs/valo/customer-experience-checkpoint.md).
The repository remains private. Older checkpoint and incident sections are historical; the linked current checkpoint is not a production-readiness declaration.

Prior security/correctness work:
[trust boundaries, durable write caps, revocation races, live counts and rights](docs/valo/security-checkpoint.md).
The GitHub repository is private and source is synchronized through draft PR2.
Managed customer identity and server AI are configured and have retained actual
execution evidence; this is not production or full R1/R2 acceptance.

Latest implemented increment: saved profile-driven checker assessments,
comparisons, private tasks and opted-in held reminders; four real-provider AI
document flows with editable private revisions and DOCX/PDF exports. The
verified-account browser run passed nine groups and checked eight private files.
See [working behaviour, actual results and remaining scope](docs/valo/checker-ai-checkpoint.md).
R1/R2 are not accepted; no Nigerian rule is released and live commerce/public
launch remain off. Earlier [foundation evidence](docs/valo/handover-checkpoint.md)
is retained.
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
