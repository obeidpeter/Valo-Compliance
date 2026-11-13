# Operating runbooks — development baseline, not staffed-launch approval

Exact owner/action contracts remain in CTX-24/25 of the engineering register.
These are role assignments, **not named staffed responders or exercised drills**.
Business-hours support is proposed; no 24/7 human-support claim is authorised.

| Runbook | Accountable roles | Minimum response and proof still required |
|---|---|---|
| Site/database unavailable | Engineering lead | Confirm impact via health and request logs; freeze risky changes; communicate through a real configured channel; restore/rollback only through the approved platform path; verify identity, saved drafts and unaffected guidance. No live drill passed. |
| Payment/entitlement failure | Finance + engineering | Disable checkout, preserve events, verify PSP server-side, reconcile reference/NGN integer-kobo amounts, repair exactly once through audited compensation, notify the buyer without collecting twice. Commerce is unimplemented/disabled; no finance drill passed. |
| Broken export / AI outage | Engineering | Preserve saved revision; inspect safe job/error state; retry only failed exports within quota/cycle limits. Restart the separate development worker if necessary. Never mark file ready before private write/read/checksum succeeds. AI remains unavailable, with manual editor access retained. |
| Incorrect compliance content | Content owner + pipeline | Suspend affected versions/search/downloads/rules, preserve historical evidence, identify affected assessments/tasks, retrieve sources, rerun all EDP gates, publish corrections and notify when material. No released content exists; no correction drill is claimed. |
| Security/privacy incident | Incident lead + privacy owner | Contain/isolate feature, revoke credentials through provider controls, preserve metadata/audit evidence, assess actual source-backed notice obligations, record decisions/remediation. Do not invent a statutory deadline or claim tested rotation/MFA. |
| Provider enquiry dispute | Support | Acknowledge only a saved ticket; check sharing consent and actual routing/delivery; clarify scope and escalate. No appointment, verified provider or email delivery is implied. |
| Deletion and recovery | Engineering + privacy owner | Verify requester, corrections/export/deletion/legal hold, approved retention and external deletion; after an authorised platform restore reapply deletion events and validate permissions. Never silently rewrite customer files. Full lifecycle/restore exercise is blocked. |

## Actual development export controls

Workflow command: `pnpm --filter @workspace/api-server run worker:dev`.
The web/API and worker are separate processes; jobs and request aliases live in
PostgreSQL, not browser memory. Job body contains only job/workspace IDs.
Use workspace-authorised API retry; never edit status to ready or fabricate a file.
Actual states are queued/running/retrying/ready/failed; three automatic attempts
and at most three explicit retry cycles are bounded independently.

Reviewed development queue setup is explicit:
`VALO_DEV_QUEUE_MIGRATION=reviewed-synthetic-development pnpm --filter @workspace/api-server queue:apply-development`.
Never run it against production. Normal workers cannot migrate at startup.
The retained SQL order and current functions/permissions need a separate approved
production path; changing publish/start commands to run DDL is prohibited.

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
