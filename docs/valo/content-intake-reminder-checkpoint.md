# Content intake, review meters and recoverable reminders

This is partial Valo development, **not R1/R2 acceptance or production readiness**.

- All 40 exact R1 template bodies compile from the merged intake manifest into
  the canonical document model. Exact source hashes and titles are checked.
  Revised inventory/expense bodies and the combined commercial source are used.
  Customer-body markers exclude internal appendices, validation notes and
  synthetic worked examples. This does not classify contracts as low risk,
  clear rights, implement every guided editor or publish any item.
- Actual editable DOCX and A4 PDF samples were generated for all 40 candidates.
  Word XML, two standard PDF-reader extraction orders and on-page word bounds
  were checked against canonical paragraphs/cells. These are unpublished
  authoring samples, not proof of Microsoft Word UI compatibility, specialist
  review or customer catalogue entitlement.
- A private review manifest binds each role's exact request, candidate, policy,
  rights/provenance/export hashes, prompt version, expiry and input meter.
  Input metering is a conservative UTF-8-byte bound plus explicit protocol
  allowance, not actual provider tokenisation or a hard monetary control.
  Responses record provider input/output usage before content validation;
  unavailable usage and billing remain unknown. Failed/reserved attempts count.
- At the retained live query, six operational review reservations and one
  separate authoring reservation existed for 14 November 2026, database
  timezone GMT. The six operational attempts are not a global provider cap.
  This batch made no publication-review provider calls or quota increase.
  Held versions cannot be mutated into published versions by waiting.
- Reminder attempts are committed before network activity, leased and fenced.
  A killed process cannot erase an attempt; expired work can recover and an
  abandoned fifth attempt becomes visibly failed. Retries use the same provider
  message reference, recheck preferences/date/source/membership and stop after
  five attempts. Opt-out cancels unsent work without losing the task.
- The reminder page distinguishes provider acceptance from inbox delivery,
  displays attempt/retry information and explains held states without internal
  error-code labels. Signed-in rendering still needs its separate browser check.
- A server-only Resend adapter uses the attached connection through the native
  connectors SDK, not a copied key. It permits only a development test to the
  selected workspace owner's currently verified primary email. The email
  excludes task titles/notes and document bodies. Controlled transport tests are
  not actual provider acceptance or inbox delivery.
- The official Resend documentation promises 24-hour idempotency retention.
  A durable first-attempt timestamp limits automatic replay to 23 hours;
  expired/unknown outcomes pause for reconciliation instead of sending afresh.
  No historical first-attempt timestamps are invented.

The linked machine report records actual commands, results and source revision:
[execution evidence](evidence/content-intake-reminder-checkpoint.json).
No result here substitutes for the separate required 80-rule, 60-customer-AI or
60-editorial acceptance suites. Published template/guidance/rule counts remain
zero at this checkpoint.

## Migration boundary

Reviewed additive SQL 0012–0014 is in the existing Drizzle journal and is tested
on an empty isolated local PostgreSQL database. The existing managed development
database predates that journal: ordinary replay correctly rejected its existing
baseline tables. No fictitious baseline migration history was inserted.
The explicit development-only additive commands apply just the new reviewed
changes transactionally and retain SQL hashes and unchanged-history evidence.
This is not full baseline adoption, production publishing, a production-shaped
staging proof, a recovery drill or a production compatibility approval.

## Remaining release boundaries

Actual publication still needs both successful independent checks and every
applicable gate on the exact final version. A commercial customer licence,
prices/refunds, real merchant sandbox execution, transactional-email delivery,
processor/retention decisions, production recovery and independent operational
acceptance remain separate requirements. The attached Resend sending-only key
is recognized through the application's native SDK; listing domains is denied
with `restricted_api_key`. Broader access is not needed merely to send.
The actual approved sender, owner-controlled test inbox and delivery are still
unverified. No email has been sent by this batch.

Development setup names (values are not recorded here):
`VALO_EMAIL_MODE=development-test`, `VALO_EMAIL_FROM` (approved bare address),
`VALO_EMAIL_TEST_RECIPIENT` (matching the selected owner's verified primary
address). Automatic backlog dispatch additionally requires the separate,
default-off `VALO_EMAIL_OUTBOX_ENABLED=development-test` switch. Supplying test
addresses alone does not enable the worker. Production sending stays disabled.

Connection readiness is not sender approval or delivery evidence.
Live payments, public launch, confidential real customer data and R3 stay off.
