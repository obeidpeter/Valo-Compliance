# Order safety

The finishing plan's Phase 5 row "Order safety": "Re-verify an abandoned or failed order before a second
order for the same edition; check the status when the customer returns from Paystack; guard an order's
line, amount and price in the database."

- **PAY-001** asks Valo to "Create immutable order lines from the current approved price book, with tax
  treatment and total in integer kobo", and accepts it when "a client-modified amount, currency, product
  or discount cannot alter the charged order."
- **PAY-006** asks Valo to "Show pending, failed, abandoned and verified-success states and provide a
  safe status refresh", and accepts it when "interrupted browser sessions recover their purchase without
  requiring an unnecessary second payment."

No call to Paystack has ever run. Everything here is built and tested against a stand-in for it.

## What there was

**An order's terms.** An order is made by `createOrder` (`modules/commerce/valo-commerce.ts`). The
browser sends which price or bundle it wants, the licence version it accepted and the access rule it
accepted. Anything else in the request is refused. The amount, the currency and the line are read from
the price book inside the transaction that makes the order.

After that the application changes four things on an order: its status, the provider's transaction, its
checkout address and the time it was last checked. An erasure changes a fifth: it puts `privacy-erased`
where the person who placed the order was named. A payment result settles an order only when its
reference, amount and currency are the order's.

**Only the code kept them.** The application's login, and the role a customer's request acts as, may
both update a row of `valo_orders`. Nothing in the database refused a statement that changed an order's
amount, its line or the price it names. One test changed an order's line with a plain update, to show
that a later check notices.

**The status.** The purchases screen has a "Check payment status" button. It asks the server, which
asks the provider and records the answer. The provider's webhook does the same. Two things are missing:

- When the customer comes back from the provider's page, nothing is asked until they press the button
  or the webhook arrives.
- An order recorded as abandoned or failed is asked about again only by the day's reconciliation.
  Until then a second order for the same edition is made beside it, though the first may have been
  paid since.

## The slices

| Slice | What | State |
| --- | --- | --- |
| 1 | An order keeps the terms it was made with | Built |
| 2 | An order is made from the price book, checked by the database as it is made | Not built |
| 3 | The status is asked for when the customer returns from the provider's page | Built |
| 4 | An abandoned or failed order is asked about again before a second order for its edition | Built |

## Slice 1: an order keeps its terms

**The database refuses any change to an order's terms.** The trigger `valo_orders_keep_terms`
(migration `20261127152513_order_terms_guard`) runs before every update of an order.

| What | Columns | Rule |
| --- | --- | --- |
| The terms | `amount_kobo`, `currency`, `line`, `price_id`, `bundle_id` | Never change |
| Which order it is | `id`, `workspace_id`, `reference`, `request_key`, `created_at` | Never change |
| Who placed it | `requested_by` | Changes once, to `privacy-erased`, and to nothing else |
| What happens to it | `status`, `provider_transaction_id`, `checkout_url`, `last_checked_at` | Change as before |
| The access rule | `carries_to_later_editions` | Already kept by `valo_orders_record_access_rule` |

- **Whoever asks.** The trigger runs for the application's login and for the role a customer's request
  acts as. A change is refused with "An order keeps the offer, the line and the amount it was made
  with", or "An order keeps who placed it, until an erasure removes them".
- **A statement that changes nothing is taken.** Setting a column to the value it has is not a change.
- **One refused column refuses the statement.** A change of status and amount together changes neither.
- **No code changed.** The application never made such a change, so nothing in it had to.

**One test puts its fault beneath the trigger.** The dispute actions' test alters an order's line to
show that a prepared action is refused when its order no longer matches. It now shows first that a plain
update is refused, then alters the line in a transaction with triggers off, as a restore or a direct
edit of the table would.

**What this does not do.**

- **It does not stop someone who administers the database.** The table's owner, or a superuser, can turn
  a trigger off. In the development and test databases the application's login owns the tables. The
  guard stops a mistaken or injected statement. The role a customer's request acts as owns nothing and
  cannot turn it off.
- **It checks nothing as an order is made.** That is slice 2.
- **An order can still be deleted** by the application's login, where nothing refers to it. No code does
  so, and the role a customer's request acts as cannot. Whether an unpaid order is ever removed is a
  retention decision, so no guard was added.

## Slice 2: an order is made from the price book (not built)

The application reads the amount and the line from the price book. The database does not check that it
did. The slice adds a check as the row is made: the amount, the currency, the content version and the
licence version are those of the price or bundle version the order names, and that offer is approved
and in effect.

Seventeen files besides the application's own make orders directly: tests, their fixtures, the customer
journey script and the migration test. Each has to be read first. One whose order is not the price
book's needs a price that says what it means.

## Slice 3: the status on return

**When the customer comes back from the provider's page, the purchases screen asks for their order's
status itself.** It reads the order's reference from the address it is opened with, under either of two
names, `reference` and `trxref`. Coming back is still not proof of payment: the reference only finds
the order, and the server asks the provider, as the order's own button does.

- **Whose order.** The workspace's own, among the orders the screen has listed. The reference is
  compared with each one whole. A reference no listed order has finds nothing, and the screen says so.
- **Asked once.** The server is asked once for an order that could still have been paid: one saved,
  awaiting payment, not completed or failed. An order already verified, awaiting staff or reversed is
  shown as it is, and the server is asked nothing.
- **What the screen says.** While it asks, that it is asking. Then what the server found, under the
  name the order's card gives that status, so that the notice and the order below it read alike. Only a
  verified payment is called verified. Where the server could not ask, its own sentence is shown, with
  the order's own button to try again.
- **Where the orders cannot be read**, the order is not looked for, and the screen says so. The
  reference stays in the address until they can be read.
- **The reference leaves the address** once the order has been looked for, so that opening the address
  again, or going back to it, asks nothing more. Anything else in the address stays.
- **The list is read again** after the answer, so the order below says what the notice says.

**What this does not do.**

- **It does not look past the orders listed.** The screen lists a workspace's hundred most recent
  orders. A reference of an older one finds nothing here, and the order's own page of history is not
  built.
- **It waits for the customer to come back.** A customer who closes the provider's page is settled by
  the webhook or the day's reconciliation, as before, or by slice 4 when they order again.

## Slice 4: before a second order

**Before another order for an edition, or a payment for one, the provider is asked again** about each
earlier order of the workspace for it that ended abandoned or failed. Such an order ended so because the
provider said so when it was last asked, and may have been paid since.

- **When.** As an order is about to be made, a template's or a bundle's, once its other checks have
  passed. And as a payment is about to be started for an order, or its saved payment page handed out
  again.
- **Which orders.** The workspace's own, for the same edition, that ended abandoned or failed and that
  the provider was asked to take a payment for: the five most recent. For a bundle, any of its
  templates' editions counts. A request repeated under its own request key is the same order, and
  nobody is asked for it.
- **How.** The transaction that was about to write ends first, with nothing written. The provider is
  asked outside any transaction, as "Check payment status" asks it, and the answer is recorded as that
  button records it. Then the transaction runs once more.
- **Paid since.** The earlier order is settled and its edition granted. The second run finds a payment
  on record: no order is made and no payment is started. The customer reads "A payment for this
  edition is already on record. Check your purchases before paying again."
- **Still unpaid.** The second run does what the first would have done.
- **The provider cannot be asked.** Nothing new is made or started, and the customer is asked to try
  again in a few minutes. Valo cannot tell whether they have paid.
- **Without a merchant** nobody is asked. No payment can be started either.
- **Each question counts** towards the customer's limit on purchase requests, as a status check does.

**What this does not do.**

- **It closes no payment page.** A page still open at the provider can still be paid on. Valo stops
  sending the customer to it.
- **It asks about five orders at most.** The daily reconciliation asks about every order.
- **A provider that can never answer for an earlier order stops new orders for that edition** in that
  workspace: after the merchant's key is replaced by another account's, for example. Nothing in the
  product settles such an order yet. That belongs to reconciliation (PAY-007). What the provider answers
  for a reference it does not know is one of the points the first run in test mode settles.

## What is not done

- **Nothing has run against Paystack.** Whether an abandoned transaction can still be paid, and how an
  unpaid one verifies, are among the points the first run in test mode settles (finishing plan, Phase 5,
  first row). Slices 3 and 4 are built against a stand-in until then.
- **What the provider adds to the address when it sends a customer back has not been seen.** The two
  names the screen reads are the ones expected of it. Its documentation could not be read from where
  this was built, so the first run in test mode has to confirm them.
- **Slice 2**, as above.
