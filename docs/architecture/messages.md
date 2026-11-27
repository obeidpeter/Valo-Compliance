# Messages

Design for the finishing plan's Phase 4, "messages". It is a proposal under the owner's delegation of 24
November. The plan's rule for the phase holds: everything here is built and tested against a stand-in
sender, and sending a real message stays off until the owner approves a provider and a sender. AGENTS.md
puts sending a real message to anyone among the owner's approvals.

The requirements, verbatim from the specification:
- WRK-003, "Reminders": "Offer opt-in email reminders using Africa/Lagos scheduling, configurable
  offsets and a delivery log. Accept: duplicate scheduler runs do not duplicate messages; unknown statutory
  dates cannot become automatic deadlines."
- WRK-004, "Delivery preferences": "Separate necessary account/purchase messages from optional
  reminders and marketing. Accept: unsubscribe and preference changes are enforced before dispatch, not just
  when the job was created."
- PRO-002, "Privacy and lifecycle": "Separate necessary processing notices from optional marketing consent;
  support profile correction, account export and deletion requests. Accept: the user can decline marketing
  and still use the product; consent versions and changes are recorded."
- PAY-008, "Refunds and disputes": "Implement approved refund eligibility, authorisation and PSP status
  tracking. Accept: a refund is not marked complete when merely requested; entitlement effects are explicit
  and user-owned drafts are not silently deleted."
- PAY-009, "Receipts and licence access": "Issue a Valo purchase receipt, show purchase history and allow
  re-download under the agreed licence. Accept: a generated business invoice is never confused with proof of
  payment or an official government tax invoice."
- SRV-002, "Real enquiries": "At R1, capture the category, scope, contact details and explicit sharing
  consent; route to Valo’s actual support workflow. Accept: the user sees “Enquiry received”, not
  “Appointment booked”; failed dispatch is visible to staff."
- IAM-001, "Real customer identity": "Use verified email-based sign-in and recovery, with optional approved
  social login. A Replit account must not be required. Accept: verification, expired-link, logout, recovery
  and suspended-account tests pass."
- EDP-011, "Monitoring and correction": "Check sources daily and re-review high-impact content monthly, other
  content quarterly, or immediately after material change/error. Suspend affected rules, stop new statutory
  reminders, flag old assessments/tasks and re-run all gates. Log the change and notify affected users when
  material. Accept: withdrawal reaches search, caches, downloads and checker; past customer files are never
  silently rewritten."

## What there is today

- **Two outboxes, one sent.**
  - Task reminders wait in `valo_reminder_outbox`. The worker sends a due one with a lease, after checking
    the opt-in, the task and its source again. It records the provider's acceptance, never delivery:
    nothing writes `delivered_at`.
  - A receipt or a processed refund leaves a row in `valo_purchase_outbox` (`purchase_receipt`,
    `refund_processed:<refund>`). It has no attempts, lease or provider reference, and nothing sends it:
    its rows say `awaiting_email_configuration`.
- **One sender, reminder-shaped.** `ReminderSender` has one adapter, through the connector to Resend. It
  sends only in development, only with `VALO_EMAIL_MODE=development-test` and `VALO_EMAIL_OUTBOX_ENABLED`,
  and only to `VALO_EMAIL_TEST_RECIPIENT`. The isolated-recovery guard blocks it.
- **Addresses.** Valo stores no owner's address. It reads the verified primary address from the identity
  provider when it needs one. A support ticket and an account-access request keep the address the person
  typed, which nobody verified.
- **Consent.** The reminder opt-in is read again before each send. Marketing consent is recorded with its
  notice version in `valo_consent_changes`, and nothing reads it. There is no unsubscribe link or endpoint.
- **Delivery.** No provider webhook exists, so nothing records a delivery or a bounce.
- **Receipts.** The purchases screen downloads the receipt as JSON. A PDF of the same receipt exists only as
  dispute evidence (`renderPurchaseReceipt`).
- **Support.** Someone who cannot sign in is told that no reply will be emailed, and a member of staff's
  reply to them stays internal. Nothing tells staff of a new or ageing enquiry.
- **Notices.** Correction, edition and rule notices appear in the app only.

## What changes

### 1. One outbox and one dispatcher (WRK-003, WRK-004)

- **The outbox.** A table, `valo_messages`, holds each message Valo means to send. The event that owes the
  message writes its row in the same transaction: a settled order, a processed refund, a reply or a
  notice.
- **What a row holds:**
  - its kind;
  - its class, `necessary` or `optional`;
  - its workspace, or none for a reply to someone not signed in or for a staff notice;
  - whom it is for: an identity, whose verified address is read when the message is sent, or a support
    request's typed address;
  - the record it is about;
  - a unique idempotency key;
  - its status, attempts, lease and next attempt;
  - the provider's message reference, and the times it was accepted, delivered or bounced, or why it
    failed.
- **No content.** A row keeps no message text. The text is composed from the record it is about when the
  message is sent, so the outbox holds nothing a customer's own records do not.
- **The dispatcher** is a worker job. It works as the reminder worker does:
  - it claims a due message with a lease, in its workspace's scope;
  - in the same transaction, just before sending, it checks again everything that could stop the
    message: the class's consent, a suppression, the safety switch and the record still being current;
  - it commits, and only then calls the sender, holding no transaction while it waits;
  - it records the result in a new transaction.
- **Retries.** A failed attempt is retried with the reminder worker's back-off, at most five times, then it
  is `failed`. An attempt the provider may have accepted is never sent afresh after the provider's
  idempotency window.
- **A pause.** A safety switch, `messages`, stops every send, as `checkout` and `all_ai` stop theirs.
- **The log.** The workspace's delivery log lists every message to the workspace and its state, the
  reminders' included. The words follow the reminders' rule: an accepted message is never called sent or
  delivered.

Built (slice 1a), for a workspace's messages to a member's verified address:
- **The table** (`lib/db/src/schema/valo-messages.ts`). A row holds its workspace, kind, class, the
  identity it is for, the record it is about, and its state. A workspace's record owes one message of each
  kind, which is the row's idempotency: a replayed event adds none. The rule is each workspace's own, so a
  row in one workspace never stands in the way of another's. The database holds each kind to its class and
  each state to agree with itself. A message with no workspace, and a typed address, join it in slice 4; a
  delivery and a bounce in slice 2.
- **The states.** `queued`, then `sending` while one attempt holds its lease, then `accepted` once a sender
  took it. `held` waits for what stops it for now. `failed` and `cancelled` end it. No state says
  delivered.
- **Queueing** (`queueMessage`). A settled order and a processed refund each write their message in their
  own transaction, beside the purchase ledger's row.
- **The dispatcher** (`modules/messages/valo-message-dispatcher.ts`), the worker's `messages` task, each
  minute. In the message's workspace scope it claims the message and, in that transaction, checks again:
  - the pause;
  - that the workspace's erasure has not begun;
  - that the recipient is still a member of the workspace;
  - that the record still owes the message: the order is still verified, or the refund is processed;
  - that the purchase ledger's row is not held.

  A message stopped for good is `cancelled`, with the reason. One stopped for now is `held`, and looked at
  again later. Otherwise it commits the attempt, calls the sender with nothing held, and records the
  result in a transaction of its own.
- **Retries.** An attempt the sender does not take is offered again after 1, 2, 4 and 8 minutes, five
  attempts in all, each with the same idempotency key, then the message is `failed`. An attempt whose
  process stopped is offered again once its 30-second lease ends. Past a sender's own window for telling
  a retry from a new message, the message fails and is not offered again.
- **The pause.** A member of staff with the system role pauses and resumes sending on the staff screen's
  "Service safety pauses", as for checkout and AI, with a reason. The pause's record counts the messages
  waiting. Checkout and AI run on.
- **Privacy.** The processing inventory and the privacy notice name the messages. A workspace's data
  download lists each message and what became of it, without whom it was for. An erasure removes them,
  and none is sent once an erasure has begun.
- **Before the table exists.** The Replit development database is given each migration by hand
  ([runbook](../valo/migration-messages.md)). Until it has this one, a payment settles and a refund is
  processed as before and no message is owed: an order settled then is sent none later, as every order
  settled before this change.

Built (slice 1b):
- **The log** (`modules/messages/valo-message-log.ts`, `GET /workspace/messages`). Any member of a
  workspace reads its messages, newest first:
  - what each is, the order it is about, and the refund for a refund notice;
  - its state and the reason for it;
  - how often it was tried, and when it is tried next.

  It says whether a message is for the member reading, and never who else it is for. It gives no message
  text, no address and nothing of the sender.
- **The words of its states.** The log has one state more than the table. A message the stand-in took is
  `recorded`, never `accepted`, and the screen calls it "Not emailed". A message a sender that sends took
  is "Accepted by email service", which the screen says does not show it reached an inbox. No state's
  name holds "sent" or "delivered".
- **The screen**, "Messages", among the account's pages. It lists the workspace's messages and the
  reminders about its tasks together, newest first. A reminder is in the reminders' own words, with the
  way to the reminders page, which keeps its own list.
- **Where a record is shown.** Each order on the purchases screen says what became of its receipt's
  message, and each processed refund what became of its notice, in the log's words. An order the log holds
  no message for says that nothing was emailed about it.
- **Two alerts** ([alerts](alerts.md), part 3), both under the worker's runbook:
  - `MESSAGES_BACKLOG`: a message still queued fifteen minutes past its time, or still marked as being
    sent fifteen minutes after its attempt's lease ended. One held is held on purpose, and is not
    counted.
  - `FAILED_MESSAGES_DETECTED`: a message that failed in the last day.

  Until the messages migration reaches a database, neither reading can be taken, and each raises the
  alert that says so.

### 2. The sender (WRK-003)

- **One interface.** `MessageSender` takes a recipient, a subject, plain text, headers, an idempotency key
  and tags, and returns the provider's reference. The reminder adapter becomes an implementation of it,
  with its gates unchanged: development, test mode, and the one test recipient.
- **The stand-in.** A controlled sender takes each message it is given and sends nothing, for the tests
  and for development without email.
- **What stays off.** No sender reaches anyone but the development test address until the owner approves a
  provider and a sender address. A production sender also needs a reviewed launch change, since production
  serves only the health check.

Built (slice 1a):
- **The interface** (`modules/messages/message-sender.ts`). A sender is handed the message's idempotency
  key, its kind, the recipient as an identity, a subject and plain text. It returns its reference for the
  message. It is never handed an address: a real sender reads the identity's verified address as it
  sends. Headers and tags join the interface with the unsubscribe headers, and the reminder adapter moves
  onto it, in slice 3.
- **The stand-in.** It sends nothing to anyone. It gives each idempotency key one reference, as a provider
  that tells a retry from a new message would. It keeps what it was handed only in a test.
- **The worker's sender** is chosen by `VALO_MESSAGE_SENDER` as the worker starts. Unset, there is none,
  and every message waits as `held`. `stand-in` is the only value there is. Any other value, or the
  stand-in in production, stops the worker before it works.

### 3. Delivery and bounces (WRK-003)

- **A webhook.** `POST /api/webhooks/email` takes the provider's signed delivery events. It refuses any
  whose signature does not verify against the provider's signing secret, and it records the event on the
  message by the provider's reference: delivered, delayed, bounced or complained about.
- **Suppression.** A hard bounce or a complaint suppresses the address for optional messages. The
  suppression keeps a keyed hash of the address, never the address. A necessary message that bounced is
  shown as such where its record is shown: a receipt that bounced is still on the purchases screen.
- **The provider.** The webhook is written for the provider the development adapter uses, behind an
  interface, so another provider needs only its adapter.

### 4. Unsubscribe and consent read before each send (WRK-004, PRO-002)

- **The link.** Every optional message carries a link to unsubscribe from its kind, and the
  `List-Unsubscribe` and `List-Unsubscribe-Post` headers for one-click unsubscribe (RFC 8058).
- **The token.** The link holds a token signed with a key of its own, naming the identity, the class of
  message and the message. It needs no sign-in, and changes nothing but that consent.
- **The record.** Unsubscribing records the change in `valo_consent_changes`, with the notice version, as the
  profile's switches do. Preferences changed in the app work the same way.
- **At dispatch.** The dispatcher reads the consent as it sends, so a change made after a message was
  queued stops it: WRK-004's acceptance.
- **Necessary messages** carry no unsubscribe link. Each says why it is sent. A customer can decline every
  optional message and still use everything: PRO-002's acceptance.
- **Marketing.** R1 sends none. The class and the check exist, so the first marketing message cannot skip
  them.

### 5. Receipts and refund notices (PAY-009, PAY-008)

- **The PDF receipt.** The purchases screen downloads the receipt as a PDF. It is the dispute evidence's
  rendering, under that rendering's notice of what it is not. The JSON stays in the workspace's data
  download.
- **The receipt message.** A settled order owes the receipt message, as it owes the outbox row today. It
  names the order's reference, what was bought, the amount and the date, and links to the purchases screen
  for the PDF. It carries no attachment.
- **The refund notice.** A refund the provider confirmed owes a notice, as today. A refund only asked for
  owes none, so a refund is never told as complete before it is: PAY-008's acceptance.
- **The purchase outbox** stays the commerce ledger's record that a message is owed. Reconciliation, the
  alerts and erasure keep reading it. A hold on its row cancels the message before it is sent. The
  message's own row, not this one, says what became of the message.

Built (slice 1a): the two messages and their words (`modules/messages/message-text.ts`), queued as above.

Built (slice 1b):
- **The PDF receipt** (`GET /workspace/orders/{id}/receipt/file`). The purchases screen's receipt is a
  link to it. It is the dispute evidence's rendering of the order's record, under its notice: "VALO
  DEVELOPMENT PURCHASE RECEIPT — server-verified test transaction record only. Not proof of delivery, bank
  outcome, a government tax invoice or official approval."
  - It is made afresh each time it is asked for, from the order's record, and nothing is stored: there is
    no file to keep, expire or erase.
  - The order is read, and the caller's access to its receipt checked, before the file is made. No
    transaction or connection is held while it is made.
  - Each file asked for counts with the files a member asks Valo to make (`VALO_LIMIT_EXPORT_CREATE`, ten
    a minute), since making one costs far more than a read.
- **What it does not hold yet:** Valo's business name and address as the owner approves them (the owner's
  point 4), a customer's name, and a tax amount. Its words are a test purchase's until the owner approves
  live payments (the plan's Phase 5).
- **The purchases screen** says under each receipt what the receipt is not, and what became of its
  message. It no longer reads the ledger's row for that.
- **The JSON receipt** stays in the API and in the workspace's data download.

**The words**, for the owner to review before the first real send (the owner's point 3). A test keeps
this page's copy the same as the code's. For an order of ₦15,000.00 made in the provider's test mode:

```text
Subject: Your Valo receipt for order valo-example-order

Valo has recorded your purchase.

Order: valo-example-order
Bought: Employment contract pack
Amount: ₦15,000.00
Recorded: 18 Nov 2026, 09:00 (Lagos time)

Your receipt is on your purchases page: https://valo.example/workspace/purchases

This is Valo's receipt for your purchase. It is not a business invoice, a government receipt or an official tax invoice.
This purchase was made in the payment provider's test mode: no real money was taken.

You receive this message because you made this purchase. It is a necessary message about your account, so it has no unsubscribe link.
```

And for its refund, once the provider confirmed it:

```text
Subject: Your Valo refund on order valo-example-order was processed

The payment provider has confirmed a refund on your order.

Order: valo-example-order
Refund: valo-example-refund
Amount: ₦15,000.00
Processed: 20 Nov 2026, 14:30 (Lagos time)

A processed refund is not yet confirmation that your bank has credited your account.
The refund is on your purchases page: https://valo.example/workspace/purchases

This refund was made in the payment provider's test mode: no real money moved.

You receive this message because a refund was processed on your purchase. It is a necessary message about your account, so it has no unsubscribe link.
```

Every payment is in the provider's test mode until the owner approves live payments, so every message
carries its test-mode line.

### 6. Support (SRV-002, IAM-001)

- **A reply to someone who cannot sign in.** A member of staff may send a reply on an account-access
  request to the address the person gave.
  - The screen says that Valo has not verified the address.
  - The reply holds only what the member of staff writes. It holds no account data, and the screen says
    so.
  - Each address is limited in how many replies it receives.
- **"Enquiry received".** The person is told their enquiry was received, and whether a reply will come by
  email.
- **Staff notices.**
  - A new enquiry, or one waiting past its time, raises an alert in the staff alert list.
  - A daily message to the support role's members names how many wait. It names no customer.
- **A visible failed dispatch.** Each reply shows its state on the case: queued, accepted, delivered,
  bounced or failed. A failed one is counted for the alerts: SRV-002's acceptance.

### 7. Notices by email (EDP-011)

- **A material notice by email.** A correction, edition or rule notice marked material owes a necessary
  message to the workspace's owner. The message names the notice's subject and links to it in the app, as
  well as the notice showing there.
- **One a day.** Several notices on one day are sent as one message.

## What does not change

- **No real message leaves Valo** but the development test address until the owner approves a provider
  and a sender.
- **The reminders keep their own outbox** and its checks. They move onto the shared sender and into the
  delivery log, not into the new table.
- **Sign-in and recovery mail** stays the identity provider's. Testing it against the provider's test
  instance is the plan's Phase 9 row.
- **No customer's message text** goes into a log.

## Slices

| Slice | What | State |
| --- | --- | --- |
| 1a | The outbox, the sender interface, the stand-in, the dispatcher and the pause, with receipts and refund notices as its first messages | Built |
| 1b | The workspace's delivery log, the PDF receipt, and alerts on messages that wait or fail | Built |
| 2 | Delivery and bounces: the webhook, suppression and the states on the log | Not built |
| 3 | Unsubscribe: the links, the endpoint, consent read at dispatch, and the reminders on the shared sender | Not built |
| 4 | Support: replies to someone who cannot sign in, staff notices and the states on the case | Not built |
| 5 | Material notices by email | Not built |

## The owner's points

1. **A provider and a sender address**, and the approval to send. Until then nothing leaves Valo but the
   development test address.
2. **Replies to an unverified address**: whether staff may reply by email to the address someone gave when
   they could not sign in.
3. **The messages' words**, reviewed before the first real send.
4. **The business details on the PDF receipt**: Valo's name and address as the owner approves them.
