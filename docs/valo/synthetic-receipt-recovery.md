# Recovery of retained synthetic purchase receipts

## Current correction and execution

The later investigation found that all 18 remaining rows met the retained
fixture checks. The actual bug was a lookup that treated **any** notification
for an order as its purchase receipt. Existing refund notifications therefore
prevented repair. Calling these 18 rows strict fixture refusals was not an
accurate diagnosis. The first run and its failures remain retained below.

The ordinary fulfilment repair, reconciliation and customer receipt lookups
now explicitly select `purchase_receipt`. A concurrent regression creates a
separate held refund notification first, creates exactly one purchase receipt,
and preserves the refund notice, order fields and suspended grant. Targeted
receipt/commerce tests passed **19/19**, with no skips.

The normal scoped recovery then observed **18 missing**, repaired **18**,
recorded **zero failures and zero remaining**, and preserved the before/after
order-history hash. A second execution observed **zero missing** and changed
nothing. These aggregate reports show that the observed missing-receipt count
reached zero. They do not record per-order IDs, so they cannot reconstruct the
individual identities/dispositions of the first run's 18 failures. These are
controlled synthetic receipts held from delivery, not real payment settlements.
New timestamped evidence files preserve both executions without
overwriting the original failed report. Provider calls and email sends: zero.

`recoverSyntheticPurchaseReceipt` is an internal development maintenance
capability, not an HTTP route, payment verifier or finance-role bypass for real
orders. It requires explicit non-deployed development, a separate maintenance
opt-in and the exact retained refund-fixture provenance, original positive NGN
order value, recorded transaction and matching existing grant.

It invokes the ordinary locked, unique, audited fulfilment repair without
creating missing grants. Recovered receipts have `held_synthetic_recovery`
delivery state, so configuration changes cannot silently release this backlog.
Existing receipt state is preserved on retries. No order, amount, licence,
refund, dispute or grant state is rewritten. A later reversal still exposes
the original synthetic amount/licence and the actual later status.

## Remaining listing and reporting correction

Purchase listings and individual receipt reads now recognize the same original
receipt audit actions, including `payment.synthetic_receipt_recovered`. A later
reversal therefore preserves the recovered original receipt link in the list.
The regression also checks its held delivery status and cross-tenant absence.

New maintenance executions preserve per-order IDs, safe reason classifications,
dispositions and every observed receipt outcome, including partial successes
when a concurrent call or repeat check fails. Post-repair observation failures
are recorded as unknown, not successful checks or reasons to discard the
collected outcomes. Each run writes a new, exclusively created UUID report under
`docs/valo/evidence/synthetic-receipt-recovery-runs/`; previous reports remain
untouched. Raw database error payloads are excluded.

The first run's failed order IDs/reasons were not recorded. This correction
does not invent them or infer their individual resolution from aggregate counts.
The later recorded 18-to-zero and zero-to-zero executions above remain valid
evidence of their observed aggregate outcomes.

Validation for this correction: six standalone reporting tests passed; the
report helper and tests passed isolated strict TypeScript checking. TypeScript
syntax parsing passed for all changed code. The extended PostgreSQL listing
regression is authored but **not run in the isolated review workspace**. Full
workspace typecheck and integrated database/runtime checks remain for Replit/CI.
No recovery command, provider request or email was executed for this correction.

## Actual execution, not an all-pass claim

The retained recovery run observed 94 missing synthetic outbox rows, restored
76, reported 18 failures, and recorded 18 remaining at that run's cutoff. Original order
history hashed identically before and after. A later read found zero missing
rows and 76 specifically held recovery receipts. That later observation does
not prove this operation repaired all 94, nor explain away its 18 refusals.
The initial refusal diagnosis is corrected above; its failed run is preserved.
No provider verification, charge/refund,
email delivery, commercial approval or genuine settlement was performed.

Before the listing/reporting correction, separate development integration: 4/4 records passed (including suite
parent), proving maintenance opt-in, refusal without an existing grant,
eight-way concurrent exactly-once receipt/audit creation, repeated recovery,
unchanged order fields, suspended-grant preservation, cross-tenant denial and
original-receipt visibility after reversal. Ordinary commerce regression:
15/15 passed. Workspace typecheck passed.

The missing-grant, non-synthetic and real-provider cases still use the normal
verified-payment/authorized finance paths; this maintenance capability cannot
substitute for their evidence. Full PSP execution and the missing dispute
submission/merchant-decision workflow remain outside this checkpoint's results.

