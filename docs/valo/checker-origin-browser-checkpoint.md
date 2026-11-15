# Actual checker browser and privacy-origin regression

Application follow-up to synchronized `7e76067484c99e51b83f23f0cb6397eb2f8c6fc7`.
No spending, identity creation, messages, publication or live payments.

## Actual changed behavior

The ruleset's long immutable hash overflowed the 360px results layout. The
actual browser check failed after preview even though the initial questionnaire
fit. The result container now permits shrinking and the ruleset span wraps.
This fixes a customer-visible mobile defect, not a changed eligibility decision.

The current result component already groups all four labels, including
**May apply**, and retains unexpected labels rather than silently dropping them.
That existing behavior is not reported as a newly implemented feature here.

## Actual privacy HTTP boundary

The hostile-origin test formerly used a revoked role and stale case version.
It now reactivates only its newly created synthetic privacy operator, reads the
current case/version and checks the `hold` action is available. It captures the
case, its signed event chain and the operator's access audit:

1. Hostile origin: 403, all three snapshots unchanged.
2. Identical active operator, session and body from the configured origin:
   200, held status, exactly one new case version and event.

All seven actual HTTP privacy checks passed, including finance-only denial,
fresh-MFA/session boundaries and the quarantined requester reply path. Identity
transport is explicitly controlled; this is not a fresh Clerk recovery/MFA
browser evaluation. An initial test-harness audit-column error was corrected;
it is not described as a product security defect.

## Actual browser execution

`test:valo-checker-browser-development` visits the real running development proxy,
not an HTML mock-up. At **360px and 1280px**, in fresh anonymous contexts, it:

- Traverses the six questionnaire steps, supplies three distinct rich privacy
  answer markers and reviews/submits them through the real HTTP endpoint.
- Confirms unknown, unanswered and not-applicable remain separate in the
  outbound request.
- Checks keyboard focus-visible state and absence of document horizontal
  overflow before and after the result.
- Adds a forged source-eligibility object to a separate synthetic HTTP request
  and receives **422** from the actual server.
- Receives zero released items and observes the honest coverage-unavailable
  result, not a compliance/exemption claim.

Both viewports passed after the overflow correction. Ruleset hash:
`e7a44f411473f787b8046f47aab5b1a790495ae0b41c504e6371a369c9466855`.

Workspace typechecking and all **26 rich-checker contract/helper tests** passed.
These 26 are engineering tests, not the original 80 source-rule acceptance cases.

## Explicit limits

The browser evidence is anonymous. It does **not** verify signed-in profile
prefill, saved assessment history/comparison or a real published rule producing
each of the four labels in a customer browser. Those remain separately tracked;
the private fixture engine's four-label tests are not public release evidence.
The eight original oracle disagreements remain unchanged. No content acquired
eligibility from these checks; no new formal customer-AI/editorial cases executed.
This is not WCAG conformance or a complete supported-device matrix.

Structured browser evidence and the initial failure are retained under
`generated-artifacts/valo-completion/`; the browser command requires the actual
development API/frontend workflows and refuses non-development/deployed modes.
Normal CI already executes the actual HTTP privacy suite.
