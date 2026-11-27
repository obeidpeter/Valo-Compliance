# Reconciliation

The finishing plan's Phase 5 row "Reconciliation": "Alert on a reconciliation that needs review; a
finance action that resolves one, with its trail; a listing from the provider's side as well as Valo's."

- **PAY-007** asks Valo to "Run daily transaction reconciliation and alert on unmatched amounts, missing
  events and fulfilment differences", and accepts it when "finance can resolve a discrepancy with an
  audit trail and without editing financial history directly."

No call to Paystack has ever run. Everything here is built and tested against a stand-in for it.

## What there was

**The daily check.** `reconcilePayments` (`modules/commerce/valo-commerce.ts`) is one of the jobs the
worker runs once a minute. Without a Paystack test merchant it does nothing. With one:

- It makes one row a day, by the UTC date, in `valo_payment_reconciliations` for every order the
  provider was ever offered: every order whose status is not `created`.
- It takes ten waiting rows. For each it asks the provider about the order's reference and settles the
  order with the answer, through `settleVerifiedOrder`, the function the status refresh and the webhook
  use. If the order is then paid, it looks for the order's grant and its receipt.
- The row ends `matched`, or `needs_review` with a finding.

**Who sees it.** Finance's area of the staff console lists the hundred latest rows as they are saved.

**What was missing**, against PAY-007:

| | What | Why it matters |
| --- | --- | --- |
| 1 | Nobody is told | A row that needs review raises no alert |
| 2 | The finding does not say what differs | An amount that differs, a provider that could not be asked and a failed statement all read `VERIFICATION_OR_FULFILMENT_DIFFERENCE` |
| 3 | A short outage reads as a difference | Three failed attempts end a row, and they can be a minute apart |
| 4 | Access withheld for a recorded reason is called a difference | A refund in full, and a dispute, each suspend the grant and leave the order paid: such an order was reported every day |
| 5 | Only one grant of a bundle's order is looked at | A bundle grants several editions |
| 6 | A missing event is never looked for | A paid order whose event never arrived looks the same as any other |
| 7 | Finance can do nothing with a row | There is no action, so nothing is ever settled, and the same difference is found again the next day |
| 8 | Nothing is read from the provider's side | An event that matches no order ends `needs_review` unseen, and the provider's own list of transactions is never read |

## What was read about the provider

Paystack's documentation site refuses automated reading (HTTP 403, 27 November 2026). Its published API
description was read instead, in part, through a fetching tool that returned quotations: the repository
`PaystackOSS/openapi` on GitHub ("The OpenAPI specification for the Paystack API"), two parts of
`dist/paystack.yaml` (about 80,000 of its 520,000 characters) and three of its source files
(`paths/transaction.yaml`, the list operation; `TransactionListResponse.yaml`;
`TransactionListResponseArray.yaml`).

| Point | What the description says | What follows here |
| --- | --- | --- |
| Verifying a transaction | `data.status` is a string, with no list of values. A 401 and a 404 answer are listed; their bodies were not read | Valo's own list of statuses is unconfirmed. What the provider answers for a reference it does not know is not known. Nothing below depends on either |
| Listing transactions | `GET /transaction` takes `from` and `to` (date-times), `status` (success, failed, abandoned, reversed), `page` and `per_page`, and cursor fields. Each item has `id`, `domain`, `status`, `reference`, `amount`, `currency`, `paid_at`, `metadata`. `meta` has `total`, `perPage`, `page`, `pageCount` | Slice 3 reads as many pages as `meta` counts. A search result, not a page that was read, gives the page size as `perPage` rather than `per_page`: slice 3 sends neither until the provider's answer settles which |
| The address a customer returns to | `callback_url`: "Fully qualified url, e.g. https://example.com/ to redirect your customers to after a successful payment" | The names added to that address (`reference`, `trxref`) were not found in the parts read. They stay unconfirmed, as [order safety](order-safety.md) says |

The first run in test mode settles each of these. Until then they are readings of a description, not of
the provider's behaviour.

## The slices

| Slice | What | State |
| --- | --- | --- |
| 1 | A check says what differs, and a difference nobody has settled raises an alert | Built |
| 2 | Finance settles a difference, with its trail | Not built |
| 3 | The provider's side: its events that match nothing, and its own list of transactions | Not built |

## Slice 1: a check says what differs

**A row's finding names the difference.** Several are joined with `;`.

| Finding | When | PAY-007's words |
| --- | --- | --- |
| `AMOUNT_DIFFERENCE` | The provider's amount or currency for the order's reference is not the order's | unmatched amounts |
| `TRANSACTION_DIFFERENCE` | The provider's transaction is not this order's: it names another reference, order or workspace, or it is not the transaction the order already holds | unmatched amounts |
| `REVERSAL_DIFFERENCE` | Valo holds the order as reversed and the provider does not | unmatched amounts |
| `ENTITLEMENT_DIFFERENCE` | The order is paid and an edition it names has no grant, or has a suspended one that nothing explains | fulfilment differences |
| `RECEIPT_OUTBOX_MISSING` | The order is paid and no receipt is recorded for it | fulfilment differences |
| `EVENT_MISSING` | The order has been paid for more than an hour and no event for its payment has arrived | missing events |
| `NO_ANSWER` | The provider was asked three times, at least an hour apart, and gave no answer that could be used | none: the check could not be made |

Rows from before this slice keep `VERIFICATION_OR_FULFILMENT_DIFFERENCE`. An erasure still rewrites a
finding to `PRIVACY_ERASURE_FINANCE_REVIEW`.

**An answer that differs ends the row at once.** `orderDifferences`
(`modules/commerce/valo-paystack-contract.ts`) compares the provider's answer with the order before
anything is settled. With a difference the order is left as it is and the row needs review. It is not
asked again that day: the provider has answered.

**No answer is not a difference.** A provider that cannot be reached, an answer that is not a
transaction, and a statement that fails each count one attempt and record its time
(`last_attempt_at`, migration `20261127191526_reconciliation_attempt_time`). The row is not tried again
within the hour. The third attempt ends it as `NO_ANSWER`. So an outage shorter than two hours ends no
row, and one row that cannot be answered does not hold up the others.

**Fulfilment is looked at edition by edition** (`paidOrderFindings`). A paid order needs a grant for each
edition it names, a bundle's for each of its templates.

- **No grant.** Settling a paid order again puts back a grant that is missing, as the status refresh
  does, unless a refund request or a dispute is on record for the order. Then it is left out, and the
  check reports it.
- **A suspended grant** is a difference unless the record explains it: the order's processed refunds
  come to its whole amount, or a dispute is recorded against it. Those are the two things that suspend
  a paid order's grant. The check changes no grant.

**A missing event.** An order is paid, by Valo's record, from the time it was last written as checked.
An hour after that, a paid order with no `charge.success` event for its reference in
`valo_payment_events` is reported. The order itself is settled and granted all the same: the check
asked the provider. The finding says the provider's events are not arriving.

**The alert.** The reading `paymentDifferences` counts the orders whose latest finished check needs
review. Above none, `PAYMENT_DIFFERENCES_DETECTED` is raised, under the runbook "Payment/entitlement
failure", for finance and engineering. A later check of the same order that matches ends it.

**What this slice does not do.**

- **Nothing settles a difference** but a later check that matches. A difference that stays is found
  again each day and keeps the alert raised. Slice 2 is the way to settle one.
- **The provider's figures are not kept.** A row says the amount differs, not by how much. Finance
  reads the figures at the provider.
- **Every order is still asked about every day**, ten a minute.
- **`RECEIPT_OUTBOX_MISSING` is not reached by a test.** Settling a paid order again records a receipt
  that is missing, before the check looks for one.

## Slice 2: finance settles a difference (design)

**What finance does.** In the finance area, a person with the finance role and a fresh second factor
opens a difference, chooses an outcome and gives a reason. Nothing about the order, its amount, its
payment or its grants is changed by this.

| Outcome | Meaning | Effect |
| --- | --- | --- |
| `explained` | The difference is understood and nothing in Valo needs changing | The difference is settled |
| `no_payment_stands` | No payment stands for this order: it was never paid, or it was refunded at the provider. Only for an order Valo does not hold as paid | The difference is settled, and the order is no longer asked about before a new order for its edition |

**Where it is kept.** The row becomes `resolved`, with its outcome and the time. Who settled it, and
why, are a row of `valo_staff_access_audit`, which the database lets nobody change or remove. A trigger
refuses a row marked `resolved` unless that audit row was written in the same transaction, and refuses
any change to a row once it is `matched` or `resolved`, an erasure's rewrite of the finding apart.

**How long it lasts.** Each day's check is a new row. A difference counts as settled while the order's
later checks find the same finding and none has matched since. A different finding, or the same one
after a check that matched, is a new difference.

**The order the provider cannot answer for.** [Order safety](order-safety.md) leaves one case open: an
abandoned or failed order the provider can never answer for stops new orders for its edition. Settled
as `no_payment_stands`, it is no longer asked about there.

## Slice 3: the provider's side (outline)

- **An event that matches nothing.** A provider event Valo could not match to an order, or could not
  verify, ends `needs_review` in `valo_payment_events`. It joins the alert's reading and finance's list,
  and is settled as a difference is.
- **The provider's own list.** Once a day the provider is asked for the day's successful transactions.
  One whose reference is no order's is recorded as an event that matches nothing.

## Decisions made here, for the owner to confirm

- **Access withheld after a refund in full, or while a dispute is recorded, is not reported.**
- **Three attempts, an hour apart, before a row reads `NO_ANSWER`.**
- **An hour's grace before a paid order's event is called missing.**
- **Two outcomes** finance can record, and what `no_payment_stands` does.
