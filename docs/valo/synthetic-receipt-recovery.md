# Recovery of retained synthetic purchase receipts

## Current correction and execution

Latest scoped evidence:
`evidence/synthetic-receipt-recovery-runs/7be3b306-a033-48af-84bc-0468518f7ca8.json`
and its append-only `.jsonl` attempt journal. All **94** corroborated cohort
orders were already present; **0** were newly repaired, **0** failed, **0**
remained missing. Order history, grants and refund notices were unchanged.
Each order has before/after state and three recorded idempotent observations.
The earlier new run `9ee804a5-3dde-4fd3-a433-40168a2ac8f0` also observed 94
already present. Neither run is represented as repairing those earlier rows.

The shared helper now specifies `kind=purchase_receipt` explicitly and inserts
the maintenance receipt directly as `held_synthetic_recovery` in its transaction.
**26/26** targeted commerce/receipt/report tests passed, including eight
concurrent repairs with a suspended matching grant and a pre-existing refund
notice; every refund/grant/order field was preserved. No message or PSP dispatch.
The first new scoped preparation failed on SQL array binding before maintenance;
its cohort-bound journal is retained rather than called a successful run.

The shared lookup defect treated **any** notification as the purchase receipt.
It is a plausible cause of failures, but the first run did not retain per-order
attempt/error records: neither that cause nor intentional provenance refusal
is proved for each of the original 18. The first failed report is preserved.

Current recovery is scoped to 94 retained order IDs established from matching
synthetic ownership, creation before the original cutoff and recovery audits by
the later cutoff. The 76/18 audit windows corroborate the reports but do not
reconstruct lost exception reasons. Each current run records all 94 IDs,
before/after provenance, receipt/refund/grant/audit state and timed per-attempt
outcomes, including safe boundary/error codes. Later fixtures are excluded.

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
not prove this operation repaired all 94, nor explain away its 18 failures.
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

