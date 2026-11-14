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
nothing. The 76 earlier repaired plus these 18 clear the observed 94-row gap;
these are controlled synthetic receipts held from delivery, not real payment
settlements. New timestamped evidence files preserve both executions without
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

## Actual execution, not an all-pass claim

The retained recovery run observed 94 missing synthetic outbox rows, restored
76, refused 18, and recorded 18 remaining at that run's cutoff. Original order
history hashed identically before and after. A later read found zero missing
rows and 76 specifically held recovery receipts. That later observation does
not prove this operation repaired all 94, nor explain away its 18 refusals.
The original failed run is preserved. No provider verification, charge/refund,
email delivery, commercial approval or genuine settlement was performed.

Separate isolated development integration: 4/4 records passed (including suite
parent), proving maintenance opt-in, refusal without an existing grant,
eight-way concurrent exactly-once receipt/audit creation, repeated recovery,
unchanged order fields, suspended-grant preservation, cross-tenant denial and
original-receipt visibility after reversal. Ordinary commerce regression:
15/15 passed. Workspace typecheck passed.

The missing-grant, non-synthetic and real-provider cases still use the normal
verified-payment/authorized finance paths; this maintenance capability cannot
substitute for their evidence. Full PSP execution and the missing dispute
submission/merchant-decision workflow remain outside this checkpoint's results.
