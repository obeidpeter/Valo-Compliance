# Receipt integration follow-up

## History and registration

Fetched private development matched local head
`91e6459108f48fc10c1ff4e9dd21ddee975d051c`. The supplied coordinator merge
`ea73a87001301cd95fa33e232be71abba381bc32`, reviewed receipt source
`52d81a2459e763df5616ff35bc794461fa35e163`, and checker source
`0bdb8db7c0ac8f2153f9e21422b52fd71f606e88` were already ancestors.
No duplicate merge, reset, force-push or older-head replacement was needed.

The reporting file is already in `test:valo`, which ordinary foundation CI
invokes. The receipt integration file is already in `test:valo-db-core`,
which ordinary database CI invokes. The receipt-focused reproducer now asserts
both registrations, avoiding duplicated CI execution. The current reporting
file has seven tests: the six reviewed tests plus the previously saved
failed-repeat observation regression. No reporting or commerce source changed
in this follow-up.

## Reproducible execution

`NODE_ENV=development node scripts/src/valo/verify-ci-portability.mjs --receipt-integration`

Run `0b130195-7471-4200-ad5f-f6cb174973ff`:
15 November 2026, **10:57:53.014–10:58:35.081 UTC**.
Application/test source was saved head `91e6459`; the test-only receipt-mode
harness change was executed before commit and is included unchanged in this
checkpoint. The containing Git revision binds that harness.

| Actual group | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Credential-free imports/native detector | 3 | 0 | 0 |
| Export zero-effects boundary | 1 | 0 | 0 |
| Receipt reporting, without a database | 7 | 0 | 0 |
| Receipt recovery, disposable PostgreSQL | 4 | 0 | 0 |
| Controlled commerce | 15 | 0 | 0 |
| Controlled refund lifecycle | 19 | 0 | 0 |
| Exact editorial-evidence controls | 6 | 0 | 0 |
| **Engineering total** | **55** | **0** | **0** |

Full workspace typecheck and Node harness syntax validation passed. Counts
include test parents; they are not 55 merchant transactions or formal UAT
acceptance. Refund/commerce transports are controlled, not Paystack execution.
Editorial controls are not new provider-backed review or a new authored
60-case evaluation result.

The reporting group ran before database provisioning. Other database checks
used a newly created loopback cluster, applied tracked SQL and reviewed queue
migrations only there, and stopped/removed that cluster. Provider credentials
were excluded. The ordinary unit/database registration assertions passed.

No maintenance recovery command ran against the existing application database
or original synthetic cohort. Only new isolated fixture orders were repaired.
No conclusion about original aggregate recovery failures follows from these
fixture successes; historical per-order evidence and uncertainty remain intact.

## Scope preserved

No new product feature, publication, paid call, external message, customer-data
deletion, deployment or main merge. No new PR12/PR13 merge or privacy change was
performed. Existing previously verified privacy integration remains preserved;
this does not authorize any subsequent unreviewed PR13 head.

The prior [privacy runtime result](pr13-runtime-verification.md) and
[checker runtime limits](pr12-runtime-verification.md) remain separate evidence.
Native storage, production recovery, privacy/commercial approvals, released
content and R1/R2 acceptance remain unproved where previously held. Hosted CI
must be reported separately from this local result.

Compact record: `evidence/receipt-integration-current.json`.
Full logs: `generated-artifacts/valo-ci-portability/0b130195-7471-4200-ad5f-f6cb174973ff/`.
