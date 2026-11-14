# Partial implementation-to-test links

The [runtime-boundary checkpoint](runtime-boundary-security-checkpoint.md) adds
exact-source-bound development export and account-state regressions. These are
partial links in the live 127-row register, not whole-requirement acceptance.

**Historical initial P0 summary below.** Its remainder column is not the current
completion inventory. Use the live 127-row `implementation-evidence.json`
register and the latest README checkpoint links, including the refund lifecycle
and account-state regressions. Old evidence is retained rather than rewritten.

The complete 127-row contract is executable in `lib/valo-core` and visible at
`/development`. Original quotations and source locators are retained. Every full
requirement remains blocked/unaccepted. This table records what the current tests
actually cover, not a claim that the full acceptance criterion has passed.

| IDs with partial coverage | Actual checks | Important remainder |
| --- | --- | --- |
| IAM-003, SEC-001 | PostgreSQL cross-workspace draft/profile/history read and write rejection; suspended membership; anonymous HTTP denial | Managed session revocation, all future orders/files/jobs/assessments, roles and signed-in browser tests |
| PRO-001, RUL-002 | All 36 states/FCT accepted; unknown/unanswered/not-applicable/zero preserved as distinct input values | Full progressive assessment, governed rules and all profile comparisons |
| PRO-002, PRO-003 | Declined marketing persists; immutable profile corrections; stale-save rejection | Account export/deletion, all consent preferences, assessment comparison |
| EDT-002, EDT-003, EDT-004 | Canonical JSON and hashes; append revisions; simultaneous saves yield one success and one 409; restore creates a new revision | Signed-in cross-device UI, all 12 guided templates, actual offline/reload/retry tests and dual exports |
| EDT-005, EDT-009, SEC-003 | Invalid/reversed dates, strict node/field boundaries, missing names never invented, arbitrary node/clauses rejected; cross-origin HTTP rejection | Final export validation, complete XSS/CSP suite, renderer network isolation |
| SEC-003 | Real preview HTTP checks of malformed/oversized JSON rejection with 400/413, no reflected input and no-store responses | Full stored/reflected XSS, CSP and injection suite remains unproved |
| SEC-005 | Atomic PostgreSQL cap under 20 concurrent calls, subject/operation separation, separate-connection persistence, expiry cleanup; real read headers ignore fabricated identity headers | Production trusted end-user IP, signed-in reads, account/global limits, alert delivery and future AI/checkout/export enforcement |
| WRK-006, SRV-002 | Durable ticket before acknowledgement; explicit enquiry sharing; support without optional sharing; metadata-only event schema | Staff queue/MFA/role UI, actual dispatch/outbox, tracking, retry/failure and email delivery |
| DOC-001, WEB-003, EDP-006–007 | Public search excludes all held templates; synthetic manifest integrity/failure tests | Search relevance against released content; real rights, sources, AI reviews, render artifacts and bounded publisher |
| EDP-010, RUL-008, AI-008 | No formal cases claimed or executed | Required distinct 60-editorial, 80-rule and 60-customer-AI suites with actual provider/source evidence |

Tests: `scripts/src/valo/*.test.ts`,
`artifacts/api-server/src/lib/valo-validation.test.ts`,
`valo-store.integration.test.ts`, `valo-http.test.ts`.
Actual outputs and source hashes are retained in
`evidence/p0-persistence-checks.json`. A source inventory title or model pass statement
never clears a row. No per-item professional sign-off has been fabricated or required.

The part 3 rows above are backed by `evidence/part3-controls-checks.json`, which
retains the new actual outputs and current source bindings. None clears the complete
SEC-003 or SEC-005 requirement. UAT-01–10 and G0–G5 remain unaccepted.
