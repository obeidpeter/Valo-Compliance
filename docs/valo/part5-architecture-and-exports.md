# Part 5 — engineering context and real development exports

Visible product: **Valo**. Internal project: **Valo Compliance**.
This is partial P0 implementation, not P0/R1 acceptance or permission to launch.

## Contract transfer

`docs/registers/engineering-context.json` retains exact original TRD sections
15–19 and 24–25, source line ranges and SHA-256 hashes. D01–D07 remain recorded
decisions, not inferred gate approvals. The 127 formal requirement IDs are unchanged.
Regenerate with `pnpm --filter @workspace/scripts exec tsx src/valo/sync-engineering.ts`.
The exact persistent model, interface/rule contract, operating actions and
handover list remain obligations even where implementation has not begun.

## Architecture decision — development adapter, not a replacement platform

Next.js/TypeScript/Tailwind, PostgreSQL/Drizzle, managed Clerk, private Replit App
Storage, pg-boss and a separate worker remain the selected stack. `docx` and
Playwright with the installed Chromium generate real files from one saved JSON
revision. No filesystem-storage, fake queue, simulated identity or PDF substitute
was introduced. Actual installed versions and package licence declarations are
captured in the evidence report; licence metadata is not a legal approval.

The generic Google Storage SDK using the prescribed blank-project configuration
failed a real write because it could not detect a project ID. The private adapter
uses Replit's documented native App Storage SDK instead, retaining the same private
storage service. This is a development SDK choice; production technical/privacy
approval is not inferred. The native SDK lacks conditional-create/metadata writes:
every worker attempt mints a fresh cryptographic object ID, never overwrites an
existing key, checks uploaded bytes, and binds source/render/file hashes in SQL.
Ready-job retries do not render again. Recoverable failed attempts remove their
temporary objects; crash-orphan reconciliation remains an explicit gap.

## Actual transaction and delivery

An authorised owner selects a saved revision, format and deliberate incomplete-draft
acknowledgement. A transaction records one job for workspace/revision/format/render
version and every request-key alias. Reusing a key for other content returns 409.
The job table acts as a durable outbox; a separate process dispatches stable queue
IDs. The worker checks workspace ownership, revision identity and saved hash again.
JSONB key ordering is normalised through the same v1 input schema used at save
time; historic hashes are not rewritten. Paragraphs, lists, tables and controlled
formatting render to editable OOXML or A4 PDF. Notices appear in both formats.

PDF accepts no uploaded HTML, disables JavaScript/service workers and aborts
network requests. Escaped text is not executable markup. Independent renderer
hardening and deployed process/network isolation remain security proof gaps.

Private bytes are uploaded and read back before a transaction marks the job ready
and appends its metadata-only activity event. Downloads require fresh managed
identity plus current membership and return checksum-checked bytes through a
private/no-store application route, never a public object path. API positive
delivery in a signed-in browser is **not yet verified**; repository/worker/storage
integration tests do not substitute for that journey.

## Migration and production blockers

- The first actual Drizzle push failed because composite foreign keys preceded
  their referenced unique indexes; its process misleadingly exited successfully.
  Corrected reviewed SQL creates parent indexes first. Development then applied
  the remaining changes successfully, and negative SQL constraints were exercised.
- pg-boss construction SQL contains functions and a custom schema. It is committed
  for review and applied only by the explicitly guarded development setup command.
  Web and worker startup use `migrate:false` and `createSchema:false`.
- Current official publishing documentation excludes functions/procedures/triggers
  and grants from automatic schema migration. No production DDL, startup migration,
  publish hook or alternative database was introduced. An approved production
  migration path and production-shaped staging test remain required.
- Private buckets are project-scoped. The same-project development worker read
  and wrote real private objects; deployed Reserved VM access and Autoscale
  scale-down behaviour have not been tested or purchased.
- Official recovery documentation describes default seven-day production history
  and up-to-28-day options on certain plans, not the proposed 35 days. Actual account
  settings, restore to an isolated environment, RPO/RTO and object recovery remain
  unproved. No dump job, backup schema, plan upgrade or destructive recovery ran.

Official references checked during this increment:
https://docs.replit.com/features/data-and-storage/publish-database-changes
https://docs.replit.com/features/data-and-storage/object-storage
https://docs.replit.com/features/sdks/object-storage-javascript-sdk
https://docs.replit.com/features/publishing/deployment-types
https://docs.replit.com/features/data-and-storage/data-recovery

## Verification and limits

See `evidence/part5-export-checks.json` for actual commands, outputs and source
bindings. Tests cover request races/aliases, old revision fidelity, cross-workspace
SQL and API-repository denial, private-object anonymous denial, checksums, real
OOXML/PDF text, long names/multipage tables/naira, suspended membership, bounded
failure/retry and queued work surviving an actual worker-process stop/restart.
The restart case does not prove an in-flight render/lease crash or web scale-down.
Native Word/manual PDF-reader checks, all twelve guided templates, five-job load,
full E2E, disaster recovery and independent security/accessibility remain unproved.
The formal 80-rule/60-customer-AI/60-editorial evaluations remain unexecuted.

Production export routes fail closed. Launch, live payments, recurring billing,
confidential customer data and R2 remain disabled; R3 remains excluded.
