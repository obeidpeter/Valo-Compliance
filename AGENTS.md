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
  the editorial gates: the reviewed route's publisher command (decision 0014) and, in development
  only, the staff library and the owner's sign-off for regulatory articles (decision 0018) and for
  requirements-check rules (decision 0020). In the staff library a person releases each version: a
  Content editor after a preview, or the owner after a current source check. On the rules' route
  the owner signs each rule's exact version. Never seed, forge or hand-insert published rows.
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
  bookkeeping outside, and the unsubscribe link's action with the workspace a link
  Valo signed names. Never give the login or the scoped role another privilege or
  membership outside a reviewed migration, and in customer code never change the
  role, `search_path` or `valo.workspace_credential`, or use session-level `SET`
  (use `SET LOCAL`). A customer
  request cannot see other workspaces' rows, so a total it needs across
  workspaces (such as a shared limit) comes from a reviewed database function
  that returns only that total, like `valo_customer_ai_reservations`. The shared
  inference ledger is written only through its functions
  (`valo_inference_budget_commit` and the others in decision 0008).
- A content version is released only on the publisher's own connection (`publisherDb`,
  `VALO_PUBLISHER_DATABASE_URL`): the database publishes a version only in a session that logged
  in as `valo_publisher_login`, which may become the publisher role and nothing else. Only
  `publishOperationalVersion` uses that connection; the `publisher-connection` repository rule
  enforces this. Never give the login another privilege or membership outside a reviewed
  migration, and never give its connection string to the API or the worker. The staff library
  (decision 0018) is the only other release: its table's own trigger, `valo_guard_manual_revision`,
  publishes an entry only for an active Content editor, and a regulatory article only for the
  development owner, from another account than the editor's and on a source check of that exact
  text under a day old.
- A content version or a prepared candidate is added only on drafting's own connection (`drafterDb`,
  `VALO_DRAFTER_DATABASE_URL`): the database adds one only in a session that logged in as
  `valo_drafter_login`, which may become the drafter role and nothing else. Only the three drafting
  paths, TPL-07's recorded drafting attempt and the check that drafting can log in use that
  connection; the `drafter-connection` repository rule enforces this. Never give the login another
  privilege or membership outside a reviewed migration, and never give its connection string to the
  API. Tests add synthetic content through `test-support/drafted-content.ts`.
- An AI review's attempt (`valo_publication_ai_attempts`) is recorded only on review's own connection
  (`reviewerDb`, `VALO_REVIEWER_DATABASE_URL`): the database records or updates a review's attempt only
  in a session that logged in as `valo_reviewer_login`, which may become the reviewer role and nothing
  else, and a drafting attempt only in one that logged in as `valo_drafter_login`. No attempt is
  removed. Only the review's record (`modules/editorial/operational-review.ts`) and its login check use
  that connection; the `reviewer-connection` repository rule enforces this. Never give the login
  another privilege or membership outside a reviewed migration, and never give its connection string
  to the API or the worker.
- A requirements-check rule's version is released on the reviewed route (`applyStoredRuleRelease`)
  or, in development, on the owner's sign-off (decision 0020, `modules/editorial/owner-rule-signoff.ts`).
  The rule table's trigger, `valo_guard_owner_signed_rule`, refuses an owner-signed release unless
  the development owner's sign-off of its exact manifest was made in the same transaction, on a
  source check under a day old; such a release changes only its status, and is never published
  again once superseded or withdrawn. Its sources are marked current only by `guideSourceDecision`,
  as a guide's are.
- A guide that says what the law requires is released only under the guidance policy
  (`guidancePolicy`, read from `docs/valo/policies/guidance-publication-policy.md`), never under
  the templates' policy; the owner's sign-off in the staff library and its readers check the same
  approval. Only the product owner approves it: the policy counts as approved only
  while `guidancePolicyApprovedHash` returns that file's own SHA-256. Never change that function
  without the owner's explicit, current approval of the file's exact text. A source is marked
  current only by `guideSourceDecision`, from its text's amendment record
  (`guidance-amendments.ts`); record there only a search, a reading or a comparison that was
  really made, with what it did not cover.
- An order keeps the terms it was made with. The database refuses any change to its amount,
  currency, line, price or bundle, and to what says which order it is
  (`valo_orders_keep_terms`, `docs/architecture/order-safety.md`). Only its status, provider
  transaction, checkout address and last check change, and an erasure's mark replaces who placed
  it. Never turn the trigger off to change an order: a correction is a finance decision with its
  own record. A test goes beneath it only to plant the fault it is about, in a synthetic order of
  its own.
- An order is made from the price book. The database refuses a new order unless the price or the
  bundle's version it names is in effect and its amount, currency and whole line are that offer's
  (`valo_orders_made_from_price_book`, `docs/architecture/order-safety.md`, slice 2). Take an
  order's terms from `priceOrderTerms` or `bundleOrderTerms`, in tests as in the application. A
  change to what a line holds changes the trigger in the same migration.
- An order is made, and a payment started or its saved page handed out, only after the provider
  has been asked again about each earlier order of the workspace for the same edition that ended
  abandoned or failed (`afterALookAtEndedOrders`, `docs/architecture/order-safety.md`, slice 4).
  A new path that makes an order or starts a payment runs through it. The provider is asked
  outside any transaction, and where it cannot be asked nothing new is made or started.
- The daily payment check compares the provider's answer with the order before it settles
  anything (`orderDifferences`, `docs/architecture/reconciliation.md`, slice 1). An answer that
  differs is recorded as the check's finding, names what differs, and settles nothing. A provider
  that gives no answer is not a difference: the attempt is counted, and the check reads
  `NO_ANSWER` only after its third, an hour apart. Never correct an order, a payment or a grant
  from the check's finding.
- A finished payment check is history. Finance settles a difference only through
  `settlePaymentCheck`, which records why in the staff access audit in the same transaction; the
  database's guard `valo_payment_checks_kept` refuses a settlement made any other way, and any
  other change to a finished check but an erasure's rewrite of its finding
  (`docs/architecture/reconciliation.md`, slice 2). A test that needs a settled check settles it
  as finance would.
- A provider event that the event worker left for finance is settled only through
  `settlePaymentEvent`, as a row of `valo_payment_event_settlements` with why in the staff access
  audit in the same transaction; the event itself is never changed for it, and the database's guard
  `valo_payment_event_settlements_kept` refuses a settlement made any other way, and any change to
  or removal of one (`docs/architecture/reconciliation.md`, slice 3a). When the worker leaves an
  event for finance, its `failure` says why, with a name `paymentEventFinding` gives.
- Only the operator commands in `FINITE_WORK_BINDING_ENTRIES` hand the inference
  dispatcher its work-binding checks (`provideFiniteWorkBindings`), and only the real
  `assertFiniteWorkBindings`; the `inference-bindings` repository rule enforces this.
- A message to a customer is never sent where its event happens. The event's transaction
  records it with `queueMessage` (`modules/messages`, `docs/architecture/messages.md`), and only
  the dispatcher hands it to a sender, after checking again whatever could stop it. A row of
  `valo_messages` holds no message text and no address. The only sender is a stand-in that
  sends nothing: a sender that reaches a real address needs the owner's approval (section 1).
- What an email provider reports about a message arrives signed at `routes/valo-email-webhook.ts`.
  Keep of a report only what `valo_email_events` holds: never the address, the subject or the
  provider's own words, and nothing of an open or a click. A message or reminder is called
  delivered only where the provider reported it (`valo_message_deliveries`), and a message the
  stand-in took never is.
- An address whose email service sent a message back for good, or where one was marked as spam,
  gets no more optional messages (`modules/messages/valo-email-suppression.ts`). Keep of it only
  a keyed checksum, in `valo_email_suppressions`, never the address. A sender that reaches a real
  address asks `addressSuppressed` of the recipient's address before it hands an optional message
  to a provider, and sends nothing when it cannot ask. Customer code reaches the list only through
  `valo_email_address_suppressed`, which answers yes or no.
- An optional message never goes without its unsubscribe link, in its words and in its
  `List-Unsubscribe` headers (`modules/messages/unsubscribe-token.ts`, `routes/valo-unsubscribe.ts`).
  A link's token holds no identifier of a person, no time and nothing random, so a retried send
  carries the same words. Opening a link changes nothing. Only a POST does: it turns that one kind of
  message off for the link's workspace, as its owner, and records the choice. Answer every link Valo
  does not honour alike, and log nothing of a link.
- A notice of a change is emailed only as its workspace's one message for the day. A change writes
  its notice where it happens, and sends nothing. The worker's task records each ended day in
  `valo_notice_digests` and queues its message (`modules/messages/valo-notice-digests.ts`); a kind of
  notice that should be emailed joins `emailedNotices` there, with the owner's approval of the
  choice. The message holds Valo's own words for a change, never what a customer wrote.
- API code is moving into one folder per capability under
  `artifacts/api-server/src/modules/`. Code outside a module imports it only through
  its `index.ts`; the `module-boundary` repository rule enforces this, and tests may
  import a module's files directly.
- The web app writes dates, times, amounts and counts only through
  `artifacts/valo/src/lib/format.ts`: on a Lagos clock, the month as a word
  ("18 Nov 2026, 09:00"), amounts in naira ("₦1,500.00"). The `web-formatting`
  repository rule fails any other `toLocaleString`, `toLocaleDateString`,
  `toLocaleTimeString` or `Intl` date or number format in the web app.

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
unless the exception and its reason are recorded there. A test file that writes a safety switch every
workspace shares, such as a staff pause, is run by a script that runs one file at a time
(`--test-concurrency=1`); that inventory fails otherwise. A test that is skipped or a todo in every
job that runs it fails the evidence job, unless `scripts/src/valo/skipped-tests.ts` records why it
cannot run in CI. Tests create only
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
- Every table whose rows a trigger guards against deletion keeps a history digest (ADM-009,
  `docs/architecture/audit-trail.md`). A migration that adds, drops, renames or retypes one of its
  columns calls `valo_history_digest_reseed('<table>')` after the change, in the same migration; the
  migration tests fail otherwise. Only migrations call it: the `history-reseed` repository rule keeps
  product code from naming it.
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
