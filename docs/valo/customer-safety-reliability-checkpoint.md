# Customer edit safety, task pages and fulfilment recovery

This is a partial development checkpoint, not completion or acceptance of R1,
R2, any whole requirement or a release gate. The visible product remains **Valo**.
The existing private application and repository history are preserved.
Implementation revision: `61c42a44dd0b40d34732f3aae50aa0efcc603d8b`.
The subsequent register refresh binds all 127 original requirement rows to this
code revision without accepting any whole requirement.

## Implemented changes

- Internal editor navigation offers save, discard or stay. Unapplied financial
  inputs are visibly unsaved, included in that decision, and cannot be exported
  as though applied. Invalid text is retained rather than silently stripped.
- Restore, undo and adoption of the authoritative saved document replace the
  financial input state too. A pristine restored form cannot apply stale inputs.
- Possible unresolved template markers prevent the generic editor from claiming
  all details are supplied. This is **not** twelve template-specific editors:
  typed shared field scaffolding exists but is not yet integrated into all twelve
  guided customer journeys.
- Task pages use server-filtered, tenant-scoped pages of twenty and actual totals,
  rather than silently treating the first two hundred records as the whole list.
  Open edits remain mounted across background refresh, including refresh failure.
  Changing a filter/page requires explicit discard when a task form is open;
  navigation offers return-to-save or deliberate discard.
- Reminders can be switched off with no offset selected. Empty saved selections
  remain empty after reload. Development-only delivery restrictions are always
  disclosed.
- Held reminders receive a bounded next-attempt time. A batch of twenty-five held
  source reminders cannot repeatedly hide an eligible later manual reminder.
  Independent operational dispatch means a reminder failure does not skip
  payment events, refunds, disputes or reconciliation.
- Development email rejects every nonempty deployment marker, including `"0"`,
  `"false"` and whitespace, as well as non-development mode. The transport checks
  the boundary again at send time. Default-off and verified-owner-only recipient
  restrictions remain in place; no real email was sent.
- A reversal retains the original verified purchase receipt, amount and licence,
  alongside its subsequent status. Repeated canonical server verification can
  repair a missing grant and/or receipt outbox atomically with an audit record.
  Existing suspended grants are not reactivated. Refund/dispute history prevents
  automatic reconstruction of a missing grant that needs financial review.

## Executed evidence and limits

The machine-readable evidence and retained raw engineering reports are generated
by `scripts/src/valo/customer-safety-checkpoint.ts`. That generator refuses a
failed final report, a missing real managed identity, failed synthetic cleanup,
or incomplete browser groups. It records the exact implementation-file hashes.

Retained final results: API engineering **116 passed, one skipped**; controlled
commerce **15 passed**; refund lifecycle **17 passed**; signed HTTP **five passed**;
task/reminder database tests **12 passed**; **four managed-identity browser
groups passed**, with zero owned-fixture cleanup errors. No real Paystack call,
email send or paid AI call was made by this checkpoint. The raw reports and
browser iteration diagnostics remain available with their limitations.

The browser journey uses an actual managed synthetic verified account, the running
application and PostgreSQL. It exercises navigation, financial edits, restore,
undo, a genuine two-tab revision conflict, background task refresh/conflict handling,
and saved empty-offset opt-out. One document PATCH is delayed and then released
unchanged to order the race; no API response is forged. Earlier fixture/runner
errors are diagnostics, not evidence of a completed acceptance suite.

The database tests include 205 active tasks plus a deleted record and another
tenant, first/full/final/empty pages, correct filtered totals, the twenty-five
held-reminder case, opt-out, bounded failures and real child-process interruption.
Commerce/refund/HTTP scenarios use controlled payment responses. They are not
actual Paystack purchases/refunds or email delivery. TAP totals include parent
test records where the runner emits them.

No source-backed 80-rule, provider-quality 60-customer-AI or 60-editorial acceptance
pass is established here. Existing synthetic engine/engineering tests remain
separate. No original content draft is thereby published, licensed for sales or
professionally reviewed.

## Still unfinished

The full twelve guided integrations, rich-fact source-rule candidate execution,
privacy verification/assignment/fulfilment/erasure/tombstones, verified email
delivery/bounce processing, remaining staff/support actions and other outstanding
R1 implementation and acceptance remain open. Production worker/storage/recovery
proof, commercial/provider configuration, independent security/privacy/usability
reviews and actual operational approvals are not established by these changes.
R2 remains prerequisite-gated and incomplete; R3 stays disabled.

No public launch, live payments, paid upgrade, quota increase, confidential real
data or new external recipient was enabled.
