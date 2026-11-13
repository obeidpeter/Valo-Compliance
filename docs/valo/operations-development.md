# Development operation and proof boundaries

## Runtime and setup

- Start/restart the existing managed API and Valo web workflows, not replacements.
- The API and Next.js bind their injected `PORT`; `/api` is same-origin.
- Clerk is managed in the workspace Auth pane. No Replit customer login is required.
- `DATABASE_URL` is used only server-side. Apply reviewed development schema changes
  with `pnpm --filter @workspace/db run push`. Do not run production schema pushes.
- Retain migration SQL under `lib/db/drizzle/`. The prepared CI migration job targets
  a disposable synthetic PostgreSQL service, never the Replit or production database.
- Production environment separation, migration ownership, worker deployment and
  processor geography are still gates, not established capabilities.

## Secret-free configuration reference

Server: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, artifact `PORT`.
Frontend build: only the public Clerk key and proxy/base path are mapped to
`NEXT_PUBLIC_*`. Never map the Clerk secret key or database connection to a client.
Managed production proxy variables are supplied by the platform; do not fabricate
them in development. No email, Paystack or AI credentials are configured by this
increment. Private App Storage was provisioned through the managed setup; its
native SDK passed real development file round trips. Production storage/worker
access and recovery remain unapproved.

## Synthetic checks

Run the commands in the root README. Database integration checks create unique
synthetic identity/workspace IDs and remove only their own UUID-scoped records.
They call the repository layer directly and do not bypass the application's Clerk
middleware. Anonymous HTTP tests check real access denial and public development
status but do not authenticate, submit real customer data or verify signed-in UI.

`valo:sync-specification` validates all exact source quotations against the retained
TRD extract before regenerating runtime metadata. Inventory stays held. A source
register link is a research lead unless actual authoritative passage evidence and
the required editorial checks have passed.

## Source control

Keep work on `feature/valo-p0-foundation`. The existing draft PR is
https://github.com/obeidpeter/Valo-Compliance/pull/2 . Preserve the original main
commit and coordinating-team specification history; never force-push.

GitHub most recently reported the repository public. Do not upload new source until
private visibility is restored and observed. The required owner action is repository
Settings → General → Danger Zone → Change repository visibility → Make private.
No additional credential value is needed. No visibility, plan or branch-protection
change was made by this increment. Expanded CI is local only until safe sync resumes.

## Recovery and rollback

Restoring an old document revision creates a new revision, retaining earlier content.
It is not a backup restore. Do not claim the proposed 35-day retention, ≤1h database
RPO or ≤4h core RTO until supported backup/recovery facilities and an authorized
isolated-target drill prove them. Do not delete active data or create an unsupported
backup system to manufacture a pass.

The seven-table initial migration is additive. A tested production rollback, deletion
tombstone replay and cross-system recovery procedure remain outstanding. Do not
automatically apply a destructive down migration.

## Support and failures

An enquiry is acknowledged only after its PostgreSQL ticket and metadata-only event
commit. `awaiting_staff` is not delivered email, provider routing or an appointment.
Staff queue UI, role separation, MFA, dispatch/retries and delivery reporting remain
unimplemented. Manual documents remain available independently of future AI features;
development-only private exports now use real renderers, a separate durable worker
and managed private storage. See `part5-architecture-and-exports.md` and
`operating-runbooks.md` for measured limits. This is not proof of signed-in delivery,
all twelve guided templates, production compatibility or disaster recovery.

## Launch controls

Only synthetic development data. No publication-ready templates or guidance; no
actual AI-reviewed content; no live checkout or recurring billing; no evidence
uploads. Replit Preview is not a public launch approval. R1 precedes R2; no R3 work.
