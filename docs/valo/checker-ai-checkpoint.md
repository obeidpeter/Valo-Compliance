# Checker and customer AI: development execution checkpoint

This is partial R1 development, not R1/R2 acceptance or production readiness.
Live payments, recurring billing and public launch remain disabled. Development
accounts and documents are synthetic.

## Working customer behaviour

- Progressive anonymous checker with explicit unknown/unanswered/not-applicable
  facts, all states/FCT, coverage gaps and no false exemption. Anonymous answers
  are not retained across reload.
- Verified managed customer account, versioned business profile, explicitly
  consented saved assessments, immutable snapshots, history and comparisons.
- Persistent private tasks with notes, confirmed optional dates, optimistic
  revision conflicts, completion/reopening and archive.
- Separate opt-in reminder preferences, Africa/Lagos scheduling and durable,
  idempotent outbox records. Email remains **held**, not sent or delivered,
  because no transactional email provider has been configured.
- Invoice, quotation, payment-reminder and proposal AI flows call the actual
  server-side provider. The model selects bounded organization of selected,
  redacted notes; application code preserves supplied facts and calculates
  integer-kobo amounts. No statutory tax rate is inferred.
- Targeted missing-information responses, unsupported-request refusal, one
  schema retry, timeout/outage fallback, development daily/minute quotas and a
  separate AI safety switch. The manual editor does not require AI consent.
- Private reloadable previews, editing, atomic/idempotent acceptance into saved
  document revisions, and real private DOCX/PDF exports from that revision.
- Financial edits rebuild derived tables deterministically; direct tampering
  or removing an existing financial model is rejected.

## Actual executed evidence

| Check | Observed outcome | Retained evidence |
|---|---|---|
| Foundation and rule mechanics | 151 passed, 0 failed, 0 skipped after evidence-binding checks | `scripts/src/valo/*.test.ts`; actual output in the development check logs |
| API units | 34 passed, 0 failed, 0 skipped | `evidence/checker-ai-development-tests.json` |
| PostgreSQL integration | 39 test entries passed, including Node parent entries | `evidence/checker-ai-development-tests.json` |
| Rule-engine evaluation | 80/80 synthetic engineering cases; **zero** Nigerian source-backed acceptance cases | `evidence/rule-engine-80-evaluation.json` |
| Customer AI evaluation | 60/60 rubric cases; 20 actual provider requests, 28 preflight cases, 12 injected negative transport cases; zero observed critical failures | `evidence/customer-ai-60-evaluation.json` |
| Verified-account browser journey | 9/9 groups passed; eight private files parsed/text-checked across the four AI tasks | `evidence/checker-customer-journey.json` |

The browser run used actual managed identity, PostgreSQL, private storage and
the export worker. Anonymous download attempts returned 401. The file checks
verified saved revision/checksums, edited text, naira amounts and private cache
headers. ZIP/XML and PDF text parsing are **not** manual Word/reader or
assistive-technology acceptance.

The rule 80 are included in the foundation count, not additional to it.
The 60 customer cases are distinct from the required editorial suite. Real
provider payload hashes were rechecked after bounded-redaction hardening;
unchanged payloads did not require repeating paid model requests.
Earlier failed browser attempts are retained separately. One genuine stale
client-revision race was fixed; harness filter/selector issues were also fixed.

## Still unaccepted or missing

- No Nigerian rule is released: actual eligibility, operative evidence,
  independent rule challenge and source-backed rule scenarios remain required.
  The running checker therefore returns honest gaps, not invented obligations.
- The 60-case editorial acceptance evaluation and first eligible publication
  are not established by these customer/rule checks.
- The 40 eligible baseline templates, 12 guided published templates, 30 guidance
  entries, 12 guides, six packs and all remaining R1 functions are not complete.
- Merchant configuration, actual sandbox settlement/refund/reconciliation and
  transactional email delivery are not proved by these results.
- Production deployment/worker/storage compatibility, isolated disaster
  recovery/RPO/RTO, approved retention/geography/processors, staff MFA,
  independent security/privacy/accessibility review and real-user beta gates
  remain outstanding. Revision restore is not disaster recovery.
- R2 remains in scope but is not enabled or accepted before R1 prerequisites.
  R3 remains excluded.

The exact 127-row specification remains authoritative. Hash-bound partial
evidence is attached to relevant live requirement rows; all release acceptance
and operational approvals remain separate.
