# Privacy request processing — partial implementation

Saved implementation: `a9eda0a1d374a286fa0532a8380da8485b016652`.
Exact file hashes and retained results: [execution evidence](evidence/privacy-cases-checkpoint.json).

## Working behaviour

- Privacy requests and their support reference commit atomically. Stable request keys recover retries without duplicate tickets; changed input rejects key reuse.
- A verified signed-in workspace owner can explicitly verify or cancel a request, read its processing history and retrieve an authorised prepared result. Revoked membership and other-tenant IDs fail.
- A separately assigned privacy operator with fresh MFA can claim a verified request, request information, hold/release, reject with reasons, prepare a scoped application JSON result or record a real current-profile revision.
- Profile outcomes must be newer than the immutable request baseline and cannot reuse the same profile hash. Existing profile versions are preserved.
- State transitions use expected versions. A keyed audit chain binds state, steps and prepared-result bytes; altered state/history fails closed.
- The customer result accurately lists its included application sections and exclusions. Local JSON preparation and profile outcomes remain **partially fulfilled**, not provider-wide completion.
- The staff queue is paginated, shows full request text and preserves unsent action details. Finance/support/content/system roles do not acquire privacy permissions.

## Executed checks

| Check | Actual result | Boundary |
|---|---|---|
| Development PostgreSQL domain integration | **10 passed; 0 failed; cleanup errors 0** | Staff identity/MFA are controlled domain fixtures, not a genuine privileged Clerk session. |
| Broader API regression | **154 records: 153 passed, 1 skipped, 0 failed** | Includes the four privacy state/audit tests; do not add overlapping counts. |
| Focused privacy state/audit controls | **4 passed, 0 failed** | Included in the broader command. |
| Managed customer browser groups | **4 passed; cleanup errors 0** | Real customer sign-up/verification, request verification/cancellation/reload, private scoped JSON and actual staff denial. The mixed support-display group alone uses a controlled staff payload. |
| Full workspace TypeScript check | **Passed** | No certification or complete acceptance claim. |
| Reviewed additive development migration | **Applied** | SQL hash retained; refund row count unchanged at 55. No production migration or fabricated baseline history. |

Mobile checks used a 360px viewport, keyboard focus and page reflow. They are not manual WCAG AA, screen-reader or real-device acceptance.

### Additional database regression and retained CI failure

The initial [CI database job failed](https://github.com/obeidpeter/Valo-Compliance/actions/runs/43614314728): its older privacy test expected ticket-only wording and its fixture teardown omitted the new foreign-key children. This was not a passing CI run.

The test now checks the explicit non-fulfilment message, actual `awaiting_verification` state, absent result, persisted event and cross-tenant denial. Cleanup removes only its owned privacy children before their ticket/workspace parents.

The complete seven-file database regression then ran serially against development PostgreSQL: **61 records, 61 passed, 0 failed, 0 skipped**. The focused ten-record access test is included, not additive.

- [Actual database regression output](evidence/privacy-full-db-regression.raw.txt)
- Tested access-integration source SHA-256: `c1d2110031ec12091bd3141cbda2e5f06d09b67aa2ae953bbdb239d7ac7aafff`
- Regression-output SHA-256: `5e0b1563f05c5ba3d5b212d3f7619cadce611412224ec7820795d10e9029f37d`

These are controlled engineering checks, not the required source80/customerAI60/editorial60 acceptance. The application implementation above is unchanged.

## Still unfinished

**Resumable erasure is not implemented or enabled.** The tombstone table is only schema, not an operational deletion/restore process. Coordinated identity/provider access, correction/deletion, retention/hold fulfilment and deletion reapplication after recovery remain unfinished.

No real privileged staff/MFA browser acceptance, provider deletion, email dispatch, Paystack execution, new content publication or production recovery was performed here.

Public observations after this change remained **0 catalogue items, 0 guidance entries, 0 practical guides and 0 deeper packs**. The supplied content drafts are not released assets.

The source-backed 80-case disagreements and required customer-AI/editorial acceptance remain separate. **PRV-003, R1 and R2 are not accepted.** Public launch, live payments and confidential customer data remain disabled.
