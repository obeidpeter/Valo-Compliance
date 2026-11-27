# Part 3 — acceptance transfer and development controls

This extends the same Valo project and feature branch. No restart, release approval
or expansion of R3 scope occurred.

## Contract reconciliation

The newly quoted 51 formal rows match the complete retained baseline:
SRV-003–004, PAY-001–010, ADM-001–009, OPS-001–008, SEC-001–008,
PRV-001–003 and NFR-001–011. The total remains **127 distinct formal IDs**,
not 178. SRV-004 retains its original R2/R3 label; R3 functionality stays excluded.
NFR rows retain their target and evidence text, not invented Must wording.

The generator now verifies all ten UAT expectations/evidence columns, the six
G0–G5 evidence/approver columns and seven release-control passages against the
retained TRD/roadmap text. Only formatting whitespace is normalized for source
lookup; the original register wording is retained. Planned windows are original
planning labels, not automatically scheduled dates or acceptance.

`GET /api/development/proof` and the existing `/development` screen expose these
records. All packs remain blocked, all gates unaccepted and all formal
80-rule/60-customer-AI/60-editorial execution counts zero. Partial foundation tests
do not count toward those suites. Required operational/security/privacy/usability
sign-offs are distinct from optional specialist review of an individual item.

UAT-02 preserves the separately authorised low-value live purchase/refund
requirement before public launch. That is a **future approval blocker**, not
permission to enable live payments or spend money now.

## Actual new development control

An additive `valo_rate_buckets` table stores operational usage counters. One atomic
PostgreSQL upsert and database-clock UTC-minute window enforce each configured cap
across processes. No process-local fallback resets usage after a web restart.
Anonymous API reads use 60/minute; cryptographically identified Clerk-user reads
use 120/minute. Actual private resource access still requires the existing verified
session, email and server membership checks.

The versioned policy also records initial AI 5/minute and checkout/export creation
10/minute ceilings. Those operations are not implemented or activated by this
change; their limits have not been proved through provider calls.

Responses expose limit, remaining allowance and reset time; denied reads return
429 with `Retry-After` and a recovery message. Health checks and the managed Clerk
proxy are exempt. Expired buckets are purged on subsequent quota-checked requests;
this is not an independent worker or a guarantee of physical deletion at exactly
two minutes.

The shared `SESSION_SECRET` is used only at runtime for domain-separated HMAC
pseudonyms. Raw IPs and user IDs are not stored in the counter table or quota-event
logs. No real secret values were read, copied or committed.

**Proxy boundary:** arbitrary `X-Forwarded-For` and user-ID headers are not trusted.
Until a trusted end-user-IP path is measured, anonymous limits use the server socket
address, which may group users behind the hosting proxy. This conservative
development behavior is **not** acceptance of production per-end-user-IP limits.

**Remaining SEC-005 scope:** approved runtime/account/global limits, trusted IP
resolution, distributed-abuse/cost alerts with owners, actual signed-in requests
and future AI/checkout/export operations. The requirement remains blocked.

Malformed JSON and oversized JSON bodies now return explicit 400/413 responses
without reflecting submitted content, rather than a misleading provider-outage error.

## Processing inventory addition — development only

Purpose: abuse prevention and cost protection. Data: keyed pseudonym, operation
bucket, UTC minute, usage count and expiry. Subjects: development requesters.
Recipients: the existing server/database only. No document body, prompt, payment
credential or raw source IP is stored in these counters. Retention: windows expire
after two minutes and are physically removed on a later checked request. Proposed
production lawful basis, processor geography, retention scheduler and privacy-owner
approval remain unapproved; this note is not a production privacy notice.

## Measured checks and limitations

Actual commands/results and source hashes belong in
`evidence/part3-controls-checks.json`. Concurrent database calls, separate connection
visibility, operation/subject isolation, bounded retry metadata, expired-window
cleanup and invalid-configuration rejection are development tests, not a deployed
worker-crash exercise. The existing tenant/concurrency suite still runs.

Migration SQL was generated, reviewed as additive and applied only to development.
The SQL file is not proof of production-shaped staging migration or a production
rollback. Independent security assessment, live PSP verification, private export,
disaster recovery and full privacy lifecycle tests remain outstanding.

GitHub synchronization remains held after the recorded public-visibility
observation. Complete changes stay version-controlled in Replit. No new repository,
visibility change, public launch, paid commitment or live commerce was introduced.
