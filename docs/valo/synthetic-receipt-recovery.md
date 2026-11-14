# Recovery of retained synthetic purchase receipts

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
