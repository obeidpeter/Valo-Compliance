# Operating runbooks — development baseline, not staffed-launch approval

Exact owner/action contracts remain in CTX-24/25 of the engineering register.
These are role assignments, **not named staffed responders or exercised drills**.
Business-hours support is proposed; no 24/7 human-support claim is authorised.
Each internal operational alert names its runbook and accountable roles from this table
(`ALERT_RUNBOOKS` in `artifacts/api-server/src/modules/operations/valo-operations.ts`); a test fails when
they differ.

| Runbook | Accountable roles | Minimum response and proof still required |
|---|---|---|
| Site/database unavailable | Engineering lead | Confirm impact via health and request logs; freeze risky changes; communicate through a real configured channel; restore/rollback only through the approved platform path; verify identity, saved drafts and unaffected guidance. No live drill passed. |
| Payment/entitlement failure | Finance + engineering | Disable checkout, preserve events, verify PSP server-side, reconcile reference/NGN integer-kobo amounts, repair exactly once through audited compensation, notify the buyer without collecting twice. Live payments are disabled: commerce runs only in the development test mode, and no finance drill passed. |
| Broken export / AI outage | Engineering | Preserve saved revision; inspect safe job/error state; retry only failed exports within quota/cycle limits. Restart the separate development worker if necessary. Never mark file ready before private write/read/checksum succeeds. AI remains unavailable, with manual editor access retained. |
| Incorrect compliance content | Content owner + pipeline | Suspend affected versions/search/downloads/rules, preserve historical evidence, identify affected assessments/tasks, retrieve sources, rerun all EDP gates, publish corrections and notify when material. No released content exists; no correction drill is claimed. |
| Security/privacy incident | Incident lead + privacy owner | Contain/isolate feature, revoke credentials through provider controls, preserve metadata/audit evidence, assess actual source-backed notice obligations, record decisions/remediation. Do not invent a statutory deadline or claim tested rotation/MFA. |
| Provider enquiry dispute | Support | Acknowledge only a saved ticket; check sharing consent and actual routing/delivery; clarify scope and escalate. No appointment, verified provider or email delivery is implied. |
| Deletion and recovery | Engineering + privacy owner | Verify requester, corrections/export/deletion/legal hold, approved retention and external deletion; after an authorised platform restore reapply deletion events and validate permissions. Never silently rewrite customer files. Full lifecycle/restore exercise is blocked. A privacy request still open after the date Valo aims to finish it by raises `PRIVACY_REQUESTS_BACKLOG`: finish it, or record in it why it is not finished. |

## Actual development export controls

Workflow command: `pnpm --filter @workspace/api-server run worker:dev`.
The web/API and worker are separate processes; jobs and request aliases live in
PostgreSQL, not browser memory. Job body contains only job/workspace IDs.
Use workspace-authorised API retry; never edit status to ready or fabricate a file.
Actual states are queued/running/retrying/ready/failed; three automatic attempts
and at most three explicit retry cycles are bounded independently.

Reviewed development queue setup is explicit:
`VALO_DEV_QUEUE_MIGRATION=reviewed-synthetic-development pnpm --filter @workspace/api-server queue:apply-development`.
It also installs `valo-operations-v1` and one every-minute schedule for each operational task
(source checks, reminders, payment events, refunds, disputes, dispute actions, payment
reconciliation), which the development worker runs as separate jobs. Run it again on a database
set up before the operations queue existed: until then the worker's queue check refuses to
dispatch (`WORKER_QUEUE_CONFIGURATION_INVALID` or `WORKER_SCHEDULES_MISSING`) and its health
reports unhealthy. A failed task stays in the queue as a failed job; the next minute's job runs it
again.
Never run it against production. Normal workers cannot migrate at startup.
The retained SQL order and current functions/permissions need a separate approved
production path; changing publish/start commands to run DDL is prohibited.

## Approving a finite AI allocation (owner only)

Recording this approval authorizes spending: up to the allocation's US$30 cap of additional
application inference, within the package's attempt ceilings, for at most 24 hours. Only the
product owner runs `approve`, or an operator acting on the owner's written instruction. Building
and testing the command spends nothing; its test runs only in a disposable database. Each command
below runs from the repository root with `NODE_ENV=development` and refuses a deployment; file
paths are relative to `artifacts/api-server`, where `pnpm --filter … exec` runs.

1. `pnpm --filter @workspace/api-server exec tsx src/scripts/finite-allocation-approval.ts prepare <package.json>`
   writes the current package, prepared from the repository's content inventory and evaluation
   corpora, and prints its id, cap, attempt ceilings and holds. It never overwrites a file. A
   package admits one kind of work: the template review pairs, or, with `--editorial-cases`
   after the file name, only the editorial case pairs (next sections).
2. The owner reads that file and writes the approval down, naming the package id, for example in a
   dated decision record.
3. `VALO_RECORD_OWNER_INFERENCE_APPROVAL=owner-approved-exact-finite-package pnpm --filter @workspace/api-server exec tsx src/scripts/finite-allocation-approval.ts approve <package.json> --confirm <package id> --approved-by <who approved> --reference <where it is written> [--hours 24]`
   records it. The command refuses a package whose limits differ from the current allocation, a
   confirmation that is not the package's own id, more than 24 hours, the delegated-child marker as
   the approver, a second approval while one is current, and a package already recorded. It keeps
   the approval only if the dispatcher's own admission check accepts it in the same transaction,
   and the database freezes the approval once written.
4. `... finite-allocation-approval.ts revoke --confirm <package id>` stops all new work under the
   package at once; an approval is never re-enabled. `... finite-allocation-approval.ts status`
   lists every recorded approval.

The package the 14 November decision packet names (`finite-package:3f21b47b…`) predates the
clarified allocation boundary, so the command refuses it: the approval names the package that
`prepare` printed. Approving never adds money. Every package draws on the one additional allocation
(`valo-additional-inference-30-20261114-v1`), whose ledger counts each reservation and charge
against its cap. Approval admits only work that passes its own preparation and readiness checks;
it does not waive a publication gate, approve content or authorize a launch.

## Reviewing and publishing a prepared template (decision 0014)

A template candidate is saved as a content version only after its two finite reviews, with those
reviews in its bundle. Steps 1, 2 and 5 call no model. Step 4 spends from an approved allocation,
so it runs only under an approval recorded as above. Run each command as in that section, from
the repository root with `NODE_ENV=development`; each refuses a deployment.

1. `pnpm --filter @workspace/api-server exec tsx src/scripts/prepare-finite-operational-set.ts <official terms snapshot.json>`
   prepares each supported template from its original intake and runs its rights, mechanical and
   export checks. A candidate that passes is kept as a private artifact awaiting its reviews. A
   candidate that fails a check is saved and held. The command prints `prepareOptions`: one
   `--candidate=<artifact id>:<sha256>` for each candidate it kept. The staff Content area lists
   the same candidates, with that reference and where each stands.
2. `... finite-inference-run.ts --prepare new <--candidate=… options>` plans both reviews of each
   named candidate and writes the private report. To plan under an approved package, use
   `--prepare finite-package:<hash> <--candidate=… options>`. Each pair binds the candidate's
   artifact, the version ID it will be saved under, and the plan.
3. The owner approves the package (previous section). `... finite-inference-run.ts --admit <report id> <sha256> [<version id>]`
   registers one pair under it.
4. `... finite-inference-run.ts --execute <batch id>` runs the two reviews and prints the result
   artifact, with `publicationAccepted: false`.
5. `... src/scripts/publish-reviewed-pair.ts <batch id> <result artifact id> <sha256>` checks each
   review against the batch's settled ledger entry and provider response, the candidate, plan,
   request and server evidence. It saves the version with its reviews, then hands it to the
   publisher, which rechecks every gate. If a gate fails, it records the hold instead. Run again
   after a stop, it finishes a saved candidate's publication or reports its saved status.

A guide that says what the law requires takes the same steps 2 to 5, under a package of its own
kind and after its own preparation. [Preparing a guide for its two reviews](guidance-preparation.md)
says what differs.

A candidate past its review date, or one whose version ID or version number is already saved, is
refused from step 2 on; prepare it again. For content that is not general, the two reviews also
answer EDP-005's enhanced checks. A check passes only when both reviews pass it and quote a passage
found in the candidate or its sources. These are AI checks, not legal, tax or regulatory review.

## Running the editorial case reviews (decision 0015)

Each case-bound editorial case whose candidate the repository can build has a review pair in the
editorial-evaluation lane. The pairs run under a package prepared with `--editorial-cases`, which
admits nothing else, and no other package admits them. Steps 1 and 2 call no model. Step 3 spends
from the approved allocation, at most two attempts per case. Run each command as in the approval
section.

1. `... finite-allocation-approval.ts prepare <package.json> --editorial-cases`, and the owner's
   approval of that exact package, as above.
2. `... finite-inference-run.ts --prepare-editorial-case <case id> --package=finite-package:<hash>`
   builds the case's candidate from the pinned retained files and its two review requests, checks
   them, and writes the private report. The case ids are the twelve in
   `preparableEditorialCases` (`modules/editorial/editorial-case-reviews.ts`), and C060 once C018 has
   run (below). `... finite-inference-run.ts --admit <report id> <sha256>` registers the pair under
   the package.
3. `... finite-inference-run.ts --execute <batch id>` rebuilds the pair at its preparation time,
   refuses any difference, runs the two reviews one after the other and prints the run report. Each
   review, or its failure, is kept as a private record.

C041, "the review provider fails", never runs here. Its pair runs only in CI's database job, against
a local destination that refuses it, so nothing reaches the provider and nothing is spent. The runner
refuses to prepare, admit or execute it (`EDITORIAL_CASE_CONTROLLED_FAILURE_ONLY`).

C060 revises C018's candidate after a real hold, so run C018 first. For C060, preparation, admission
and execution each refuse with `EDITORIAL_CASE_PREREQUISITE_NOT_MET` until C018's latest admitted
pair has both reviews and at least one holds. The reports name the C018 batch that keeps the failed
evidence. If both of C018's reviews pass, C060 cannot run, and an independent reviewer decides what
that means for both cases.

The reports keep `formalCaseAccepted: false`. A case counts only after an independent reviewer
confirms its expected outcome (decision 0015, point 5), and the reviews are AI review, not legal,
tax or regulatory review.

## Recovery/launch/handover

Use development checkpoints or the supported production recovery pane, never
in-app dumps, shadow backup tables/schemas or source-code ZIPs as data backups.
No destructive restore runs without an approved target and impact review.
The proposed 35-day retention and RPO/RTO are not established by native history.
Do not accept real confidential data until processor/geography and retention
decisions are approved.

Before a sensitive deployment: recoverable backup evidence → reviewed migration
and rollback → staging candidate → recorded product/security/privacy approvals
and passing exact-version AI manifests → authorised deployment/live smoke →
limited traffic/monitoring. None of those approvals is created by this file.

Handover includes lockfile/source, reviewed schema/SQL, secret-name catalogue,
API schemas, this and deployment/recovery runbooks, architecture decisions,
template rights, actual source snapshots/claim maps, rule fixtures, model/prompt
versions/findings/manifests, independent security/manual accessibility reports,
privacy register, admin/support guide, known issues, ownership checklist and
requirement-to-evidence matrix. Missing items remain missing, not satisfied by
the source inventory. Daily reconciliation/source checks, weekly operational/cost
review and quarterly/major-change restore exercises are future staffed operations.
