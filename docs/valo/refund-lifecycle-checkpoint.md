# Refund and finance development checkpoint

Implementation revision: `cb32f1bc2eaf0a49ca6ead2ce9540a2204e7a058`.
This is partial development evidence, **not accepted R1/R2**, actual Paystack
execution, a customer bank-credit confirmation or production readiness.

## Implemented behavior

- Customer full/partial requests have explicit integer-kobo amounts, strict
  input validation, stable request keys and accepted `test-refund-v1` policy.
  Existing unknown-amount requests are not guessed or automatically approved.
- Order locks serialize reservations. Concurrent requests cannot spend the same
  balance. A final dispatch check catches reversals, disputes and late refunds
  which change the balance after authorization.
- Finance approval/rejection records reasons and an expected version. Both the
  server identity boundary and the commit-side finance role require fresh MFA.
  A committed membership/role revocation defeats a waiting write.
- The worker commits a fenced, bounded attempt before I/O, keeps one original
  refund reference, recovers unknown POST outcomes by provider lookup and stops
  after five attempts. Read-only reconciliation never invents a replacement
  reference or treats a request as completion.
- Canonical test-mode provider observations must match transaction, reference,
  amount and NGN currency. Processed observations cannot be downgraded by late
  pending responses. Signature-authenticated refund/dispute events are durable
  hints, not entitlement or bank-credit proof.
- Partial processed refunds leave remaining reuse subject to reversal/dispute
  holds. A full processed refund suspends future template reuse. Private saved
  drafts/revisions and already downloaded local files are not retracted.
- Customer history and fresh-MFA finance screens expose actual recorded states.
  Disputes are fetched/verified and visible; their evidence submission and
  merchant accept/decline workflow is **not implemented**.
- Append-only transition triggers reject changes; test teardown retains their
  explicitly synthetic financial FK parents rather than disabling protections.

## Executed evidence

See [hash-bound actual results](evidence/refund-lifecycle-checkpoint.json).

| Executed package | Result |
| --- | --- |
| Refund PostgreSQL | 17 passing TAP tests: 16 scenarios plus suite parent |
| Existing commerce PostgreSQL | 14 passing TAP tests: 13 scenarios plus parent |
| Controlled native refund transport | 5 passing TAP tests: 4 controls plus parent |
| Raw-body signed HTTP regression | 5 passing TAP tests: 4 controls plus parent |
| API regression | 114 passing, 1 expressly skipped, 0 failed |
| Workspace typecheck | passed |
| Empty isolated local PostgreSQL | all 17 journalled migrations, tenant/uniqueness/audit/publisher invariants passed |

The refund suite includes actual kernel SIGKILL, revoked membership/finance
races, stale writes, duplicate/reordered responses, post-acceptance timeout,
cumulative partial reservations, unknown legacy amounts and changed financial
state. Provider responses are **controlled**; real payment/refund calls: **zero**.
The local empty database proof is neither managed production restore nor
production migration adoption. The managed development baseline remains
unadopted; additive migrations were explicitly applied without inventing history.
Initial quota-fixture and audit-teardown failures are recorded in the receipt,
with original raw failures retained under ignored generated-artifacts.

The public mobile landing page was inspected after restart. Private finance
browser interaction and real staff fresh-MFA were **not verified**. The actual
unauthenticated finance endpoint returned 401.

## Remaining setup and implementation

- Paystack test merchant configuration is absent: explicitly select the active
  signature mode and its server-side secret, test API key, and separately enable
  sandbox checkout/refund switches. Never use live keys or silently downgrade
  timestamped signatures. No actual sandbox outcome is claimed.
- A designated real finance test account with fresh managed MFA is needed for
  the real privileged browser journey; synthetic database role fixtures are not
  that proof. No real-user privileges were granted by this checkpoint.
- `test-refund-v1` is a disclosed development policy, not accepted live commercial
  pricing, refund eligibility or customer licence terms.
- No email was sent. Sender/owned-recipient configuration and verified delivery
  evidence remain separate; automatic backlog dispatch remains off.
- The read-only review ledger inspection on 2026-11-14 found three factual and
  three challenge reservations, plus one separate drafting row. These legacy
  unmetered rows are not a verified bill or a global provider cap. No new model
  calls were made and the operational review cap was not raised or bypassed.
- None of the supplied 80-source-rule/60-customer-AI/60-editorial full acceptance
  suites was completed by these engineering tests. Eligible publication remains
  zero. Forty templates/thirty guidance bodies remain inputs, not publications.
- Twelve guided customer editors, the other remaining customer/admin/privacy/
  email/content/evaluation/operational requirements, independent assessments and
  R1 approvals are still incomplete. R2 prerequisites have not passed; no R2/R3
  feature is claimed accepted.

Current official refund, webhook, dispute and verification documentation was
retrieved during implementation; hashes/observations are retained in
`generated-artifacts/valo-completion/refund-provider-reference.json`.
This work maps partial evidence to PAY-004–009, ADM-001/009,
SEC-001/005/006, OPS-003 and NFR-009; no complete requirement is accepted.
