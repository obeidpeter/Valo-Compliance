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
  - in the same transaction, just before sending, it checks again what could stop the message: the
    class's consent, the safety switch and the record still being current;
  - it commits, and only then calls the sender, holding no transaction while it waits;
  - the sender reads the recipient's address then. For an optional message it asks of that address
    whether Valo has stopped sending there (part 3), just before it calls the provider. The dispatcher's
    transaction cannot ask: it does not hold the address, and reading it is a call to another service;
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
  sends. Headers and labels joined it in slice 3b, below.
- **The stand-in.** It sends nothing to anyone. It gives each idempotency key one reference, as a provider
  that tells a retry from a new message would. It keeps what it was handed only in a test.
- **The worker's sender** is chosen by `VALO_MESSAGE_SENDER` as the worker starts. Unset, there is none,
  and every message waits as `held`. `stand-in` is the only value there is. Any other value, or the
  stand-in in production, stops the worker before it works.

Built (slice 3b):
- **What else a sender is handed.** A message can carry headers for its reader's mail program, labels
  for the provider to keep, and a mark that it is optional. A sender asks whether Valo has stopped
  sending to the address only for an optional message, and answers that it sent nothing if so. A
  necessary message is owed whatever became of its address, and nobody is asked.
- **The reminders' development mailer is a sender of this kind** (`modules/tasks/valo-reminder-resend.ts`).
  It sends whatever message it is handed, with its gates unchanged: development only, never while a
  recovery is rehearsed, and only to the configured test address, which must be the recipient's own
  verified one. It reads a key, a subject and each header as one plain line before it sends them.
- **A reminder is made before a sender is asked** (`modules/tasks/reminder-message.ts`): its words, its
  unsubscribe headers and its labels, handed over as an optional message under the reminder's own key.
  So any sender of this kind can be given a reminder.
- **Nothing a reminder's reader gets has changed.** A test holds the request the provider is sent to
  what it was before, to the byte, with its key. A reminder first tried before this slice and retried
  after it is the same request.
- **One order changed.** A reminder's link is now made before the sender looks at the address, so one
  is made for a reminder to an address Valo has stopped sending to. It goes nowhere.
- **The outbox's own sender is still the stand-in, and nothing else.** The development mailer is not
  offered to it: a receipt sent to the test address would be a real message of a new kind, which is the
  owner's to approve. The mailer stays with the reminders, which are all it sends.
- **The reminders' outbox does not record which sender took a reminder.** So outside tests a reminder is
  handed to the development mailer alone: one the stand-in took would read as sent.
- **An answer without a reference is no acceptance.** The outbox's dispatcher takes a sender's answer
  that an address is stopped as it takes a blank reference: the message was not taken, and is offered
  again. Every message of the outbox is a necessary one.

### 3. Delivery and bounces (WRK-003)

- **A webhook.** `POST /api/webhooks/email` takes the provider's signed delivery events. It refuses any
  whose signature does not verify against the provider's signing secret, and it records the event on the
  message by the provider's reference: delivered, delayed, bounced or complained about.
- **Suppression.** A hard bounce or a complaint suppresses the address for optional messages. The
  suppression keeps a keyed hash of the address, never the address. A necessary message that bounced is
  shown as such where its record is shown: a receipt that bounced is still on the purchases screen.
- **The provider.** The webhook is written for the provider the development adapter uses, behind an
  interface, so another provider needs only its adapter.

Built (slice 2a):
- **The webhook** (`routes/valo-email-webhook.ts`, `POST /api/webhooks/email`). It is mounted beside the
  payment webhook, before the JSON parser and sign-in: the signature is over the body exactly as it was
  sent, and the provider is no browser and no member.
  - It answers that it is not set up unless the runtime is development and `VALO_EMAIL_WEBHOOK_SECRET`
    holds the provider's signing secret. Only the development mailer sends through the provider, so only
    development takes its reports.
  - It refuses a body whose signature does not verify, or that was signed more than five minutes from
    now. Each refusal is counted with the payment webhook's, for the alert on signature failures.
  - It keeps a report before it answers, and a report delivered twice is one report.
- **What is kept, and what is not.** A report keeps the provider's own id for it, what it says, the
  provider's reference for the message, its time, and a bounce's kind. The subject and the provider's own
  words are never read, and no address is kept. Since slice 2b the address of a bounce or a complaint is
  read, to make the checksum below, and for nothing else. Nothing is kept of an event that says a message
  was handed over, opened, or a link in it followed: Valo does not track opens or clicks.
- **The signature** (`modules/messages/email-events.ts`) is the scheme the provider's documentation
  describes, read on 26 November 2026: the report's id, its time and the body, joined by full stops,
  under HMAC-SHA256 with the secret's key. The scheme's published example verifies in a test. No request
  of the provider's has been checked against it, since none has been received.
- **Recording** (`modules/messages/valo-email-events.ts`), in the worker's `messages` task. For each
  waiting report it finds the message or reminder that holds the provider's reference. In that record's
  workspace scope it records the report in `valo_message_deliveries`, one row for each record.
  - A report replaces the one a record holds only if it says more: delayed, then delivered, then
    undelivered, then bounced, then complained. So the reports about one message leave the same record in
    whatever order they arrive.
  - A report is about a message only if a sender of the report's provider took the message. A message
    the stand-in took was sent to no one, and is never given a report.
  - A report no record holds the reference of waits an hour: a report can arrive before the attempt that
    handed the message over has recorded the reference. Then it is settled as unmatched.
  - A settled report is removed thirty days later. What it said stays on the record.
- **What a record shows.** The log and the reminders list give the report beside the record's own state,
  which stays `accepted`: `delivered`, `delayed`, `bounced`, `complained` or `undelivered`, with the
  provider's time for it.
  - The screens say "Delivered" only for the provider's report. They name the email service as the one
    saying so, and say that Valo cannot see whether the message was opened.
  - A message that came back says that the address may be wrong. One the provider could not send offers
    the way to report a problem.
  - Each order on the purchases screen says what became of its receipt's message in the same words, so a
    receipt that came back still shows, with that said under it.
- **Privacy.** The processing inventory and the privacy notice name the reports. A workspace's data
  download lists its own. An erasure removes them.
- **Before the tables exist.** Until the two migrations reach a database, the webhook answers that it is
  not set up, the task records nothing, and the log and the reminders list as before.
- **The provider** is one object (`EmailEventSource`): its name, its signature check and its reading of
  an event. Another provider needs only its own.
- **What can have a report today.** Only the reminders' development mailer sends through the provider,
  to one test address, so only a reminder can. A report reaches Valo only once the owner sets the
  signing secret and gives the provider the webhook's address.

Built (slice 2b), suppression (`modules/messages/valo-email-suppression.ts`):
- **What suppresses an address.** A bounce the provider calls permanent, or a complaint: the message was
  marked as spam. Nothing else does.
  - A bounce the provider calls temporary or cannot classify, a delay, and a failure of the provider's
    own do not: the address may be good.
  - A report that the provider itself will not send to an address does not either. The provider's own
    list already stops that message, and clearing it there is enough.
- **Only about a message Valo holds.** A report suppresses once the worker has found the message or
  reminder it is about, and never before. A signed report about nothing Valo sent suppresses no one, and
  neither does one about a message the stand-in took.
- **What is kept.** The webhook reads the one address a bounce or a complaint names and makes a keyed
  checksum of it, under the privacy keyring's current key. The report's row keeps the checksum and the
  key's version. The address is kept nowhere.
  - A report that names several addresses, or none, keeps no checksum and suppresses no one. Valo sends
    each message to one address.
  - `valo_email_suppressions` holds one row for each checksum: why, as last reported, the first and last
    reports' times, and when it ends. It names no person and no workspace.
- **How long.** 180 days from the last report, which is a proposal for the owner to decide. A later
  report keeps the suppression going and never shortens it. The worker's `messages` task removes one
  whose time has passed. The address is then tried again, and suppressed again if its email service says
  the same.
- **A replaced key.** The question is asked under every key the keyring holds. A suppression made under
  an earlier key still counts while the keyring keeps that key.
- **Asking.** `addressSuppressed` answers yes or no for an address. A sender asks it just before it
  calls the provider, when it holds the address and no transaction.
  - The worker's per-workspace jobs and customer requests cannot read the list. They ask through a
    database function, `valo_email_address_suppressed`, which answers only yes or no, for checksums the
    caller already holds.
  - If the question cannot be asked, nothing is sent.
- **Which messages.** Optional ones, which today are the reminders. Their development mailer asks before
  each send.
  - A reminder to a suppressed address is cancelled with the reason `EMAIL_ADDRESS_SUPPRESSED`. It is not
    counted as a try, and is not tried again. The reminders screen says why, that the task is saved, and
    offers the way to report a problem.
  - The outbox holds only necessary messages: a receipt, a refund's notice and a day's notices. A
    suppression does not stop them: they are still owed, and a receipt that came back still shows on
    the purchases screen.
  - When an optional kind joins the outbox, its sender asks the same question. Since slice 3b a sender of
    the shared kind asks it for any optional message it is handed (part 2).
- **Privacy.** The processing inventory and the privacy notice name the checksum, what it is for and how
  long it is kept. A suppression is about an address and names no account: a data download does not list
  it, and a deletion request does not remove it. The notice says so.
- **Before the table exists.** A database the first suppression migration has not reached takes no
  report at all, so none is recorded without what it should have stopped; what was recorded before is
  still shown. No address is suppressed there, and reminders go on as before. With the table and not the
  function, which is the second migration, the question cannot be asked and no reminder is sent: the two
  are applied together.

Not built: a way to end a suppression sooner at a person's request. It ends by itself 180 days after the
last report. Ending one by hand also needs the provider's own list cleared, so it waits for the provider
the owner approves, and belongs with the staff's tools in slice 4.

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

Built (slice 3a), for reminders, which are the one optional message there is:
- **The link in each reminder** (`modules/tasks/valo-reminder-resend.ts`). The development mailer puts it
  in the reminder twice: in its words, as the address of a page, and in the `List-Unsubscribe` and
  `List-Unsubscribe-Post` headers, from which a mail program offers its own unsubscribe button.
  - A reminder never goes without it. If the link cannot be made, nothing is sent.
  - The headers' form is the one the provider's documentation gives, read on 27 November 2026. No
    reminder has been sent with them and looked at in a mail program.
- **The token** (`modules/messages/unsubscribe-token.ts`) says which kind of message it stops, and names
  the workspace and the reminder that carried it.
  - It does not name the person, as the design above said it would. It holds a keyed mark that tells
    the person it was made for from anyone else, and that cannot be turned back into their identifier.
    So a link names no one to whoever reads the address it sits in.
  - It is signed under a key made for these links alone, from the privacy keyring's current key.
  - It holds no time and nothing random. The same reminder gets the same link on every attempt, so a
    retried send carries the same words as the first.
  - It does not expire. It stops working when its key leaves the keyring.
- **Two ways in** (`routes/valo-unsubscribe.ts`), which do the same thing:
  - **The page**, `/unsubscribe`. Opening it changes nothing, so a mail program or a scanner that
    follows the link stops no one's reminders. The page says what its button will do. Pressing the
    button asks `POST /api/public/unsubscribe`, which is in the client contract and is sent as Valo's
    own pages send a change.
  - **A mail service's one-click request**, `POST /api/public/unsubscribe/one-click`. It is mounted
    beside the webhooks, outside the client contract, sign-in and the check on where a request came
    from: such a request comes from a mail service's own machines. Its body is not read. A mail
    program that opens that address instead is sent to the page, with only a token's own characters
    passed on.
- **What a link does** (`modules/tasks/reminder-unsubscribe.ts`). It turns its workspace's reminders
  off, as the owner would in the app, in that workspace's database scope.
  - The choice is recorded in `valo_consent_changes` with the notice in force, as the owner's.
  - Every reminder still waiting is cancelled. One cancelled earlier keeps its own reason, and one
    already sent stays sent.
  - The workspace's history names the reminder that carried the link (`reminders.stopped_by_link`).
  - The days chosen are kept, for when reminders are turned on again. Nothing else changes.
  - Used again, a link answers the same and changes nothing.
- **Whom a link works for.** Reminders go to the workspace's owner. A link made for someone who is no
  longer the owner stops nothing. Neither does a link for a workspace that takes no change of its
  owner's: one that is gone, whose owner's access is off, or whose deletion is recorded. No reminder is
  sent in that state either, since the worker makes the same checks before each one.
- **Refusals are alike.** Every link Valo does not honour gets the same answer, which does not say why.
  The log line says only that a link was refused, and holds nothing of the link.
- **Before each send** (WRK-004's acceptance). The worker reads the opt-in again in the transaction that
  claims each reminder, as it did before this slice. So a reminder planned before a link was used is not
  sent after: it is cancelled, and no sender is handed it.
- **A limit.** One workspace's links are taken ten times a minute (`VALO_LIMIT_UNSUBSCRIBE_LINK`), and
  the next use is told when to try again. Nobody is signed in, and a mail service asks for many people
  from the same addresses, so the count is by the link's workspace. It is taken only once the link's
  signature has been checked.
- **The page's address tells no one.** The token is in the page's address. That page alone is sent
  with the `no-referrer` policy, so no request it makes names it: not to Valo's own servers, and not
  to the sign-in service, which a launch would reach through Valo's own address. The API's log keeps a
  request's route and never its address.
- **Production** answers only the health check, as before. The rehearsal checks that the three
  unsubscribe requests are refused there.
- **Privacy.** The processing inventory and the privacy notice name the link. A choice made by a link is
  in the workspace's consent history with the others, and an erasure removes it with them.
- **A retry across a change.** A reminder first tried before this slice and retried after it carries
  different words, and so does one retried after the keyring's current key changes. The provider's
  documentation says it refuses a retry whose content differs from the first under the same key. Such
  a reminder goes at most once and ends as not confirmed. No request has shown this.

Built (slice 3b): the reminders go through the shared sender, as an optional message with this link in
their words and their headers (part 2).

Not built:
- **Consent read by the outbox's dispatcher.** The outbox holds only necessary messages, and its table
  takes no other kind. When an optional kind joins it, its dispatcher reads that kind's consent as it
  sends, and its messages carry this link. R1 sends no marketing, so nothing reads the marketing choice
  yet, and there is nothing to build until such a kind exists.

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

Built (slice 4a), the alerts, which send nothing:
- **Two readings of the support cases** (`modules/operations/valo-operations.ts`), taken with the
  others each minute:
  - an enquiry nobody has taken: its case is open. A new enquiry is, and one is again when its
    customer replies and nobody is assigned to it;
  - an enquiry waiting on Valo past its time: its case is open or in progress, and nobody has
    touched it for more than 48 hours.

  An enquiry that waits on its customer, and a resolved one, wait on no one at Valo, and are not
  counted.
- **Two alerts**, `NEW_ENQUIRIES_DETECTED` and `WAITING_ENQUIRIES_DETECTED`, each raised by any such
  enquiry and cleared when there is none. They fall to the enquiries runbook and the support role,
  and read in plain words. A reading that cannot be taken raises an alert of its own.
- **Who sees them.** The alert list is the system operator's. Support staff do not read it: they
  have the cases themselves, in their own queue. So an alert tells the operator that an enquiry is
  waiting, and the second that one has waited too long. No one is emailed or paged by either.
- **The 48 hours** are Valo's own aim, and a proposal (the owner's point 8). No reply time is
  promised to anyone.

Not built (slices 4b and 4c):
- **A reply by email to someone who cannot sign in**, with its states on the case and a failed one
  counted for the alerts. An access request has no workspace and no verified identity, so its reply
  cannot wait in `valo_messages`: it needs an outbox of its own, a sender that is handed the address
  the person typed, and a limit for each address. That is slice 4b.
- **"Enquiry received" saying whether a reply will come by email.** It says today that replies are
  not sent from this build, which is true until slice 4b.
- **The daily message to the support role's members.** That is slice 4c.

### 7. Notices by email (EDP-011)

- **A material notice by email.** A correction, edition or rule notice marked material owes a necessary
  message to the workspace's owner. The message names the notice's subject and links to it in the app, as
  well as the notice showing there.
- **One a day.** Several notices on one day are sent as one message.

Built (slice 5), against the stand-in sender. No message reaches anyone:
- **Which notices are emailed** (`modules/messages/valo-notice-digests.ts`). No notice carries a mark
  saying that it is material, as the design above supposed, so the kind of notice decides:
  - every correction notice: one of the workspace's tasks, saved results, documents or purchases used
    a source or a version that is now held or withdrawn;
  - every rule notice: a requirement the workspace saved a result or made a task from was replaced
    or withdrawn. [Rule changes](rule-changes.md) already treats each such change as material;
  - a template's withdrawal.

  A template replaced by a later edition is shown in the app only. The choice is a proposal (the
  owner's point 7).
- **One message for a day.** The worker's `messages` task records in `valo_notice_digests` that a
  day's notices owe their workspace one message, and queues it to the workspace's owner in the same
  transaction, as a necessary message.
  - A day is recorded from 07:00 the next morning on a Lagos clock. The day has ended, so its notices
    are all there, and the message does not arrive in the night.
  - A workspace has one row for a day, and the database holds a row to a day that has ended. A
    second run, or a second worker, adds none.
  - A worker that was stopped catches up a week back, with one message for each day. Notices older
    than that stay where they have been since they were made, in the app.
  - Once every ended day is recorded, the task does not read the week's notices again until the
    next morning.
- **What the message says** (`noticesMessage`). It is composed when it is sent, from the day's
  notices as they are then:
  - each changed requirement by its title, as replaced or withdrawn, and each withdrawn template by
    its title: up to ten of each, with a count of the rest;
  - how many of the workspace's saved items a correction asks it to review. An item that two changes
    reached that day is counted once;
  - a link to the workspace page, where each notice is. It does not link to each notice, as the
    design above said it would: the page lists them together;
  - why it is sent, and that it is a necessary message with no unsubscribe link.

  It holds nothing the customer wrote. A title is Valo's own, and is written on one line. A day
  with no notice left owes no message, and its message is cancelled.
- **What stops any message stops this one**: the pause, a recipient who is no longer a member, and
  a workspace whose deletion is recorded. No day is recorded for such a workspace in the first
  place.
- **What a customer sees.** The Messages page lists the message under its day, says that the notices
  themselves are on the Workspace page, and links there.
- **Privacy.** The processing inventory and the privacy notice name the message. A workspace's data
  download lists its days, and an erasure removes them.
- **Without its migrations** no day is recorded and nothing is emailed, and notices show in the app
  as before ([the migration note](../valo/migration-messages.md)).

Not built:
- **A mark on one notice.** Nothing lets a member of staff say that a single change is not
  material, so that it would show in the app with no email ([rule changes](rule-changes.md), the
  owner's point 2).

**The words**, for the owner to review before the first real send (the owner's point 3). A test keeps
this page's copy the same as the code's. For a day on which two requirements changed, a template was
withdrawn and two saved items used a source or a version that was held or withdrawn:

```text
Subject: Changes on 18 Nov 2026 that affect your Valo workspace

On 18 Nov 2026 Valo recorded changes that affect what you saved, made or bought in your workspace.

Requirements Valo checks:
- Replaced by a later version: File the company's annual return
- Withdrawn: Register a food product

Templates:
- Withdrawn: Employment contract pack

Saved items to review:
- 2 of your tasks, saved results, documents or purchases used a source or a version that is now held or withdrawn. What you saved and the files you made are unchanged.

Each change, and what it affects, is on your workspace page: https://valo.example/workspace

You receive this message because these changes affect what you saved, made or bought in Valo. It is a necessary message about your account, so it has no unsubscribe link.
```

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
| 2a | Delivery and bounces: the webhook, the reports recorded on messages and reminders, and their words on the log | Built |
| 2b | Suppression: a hard bounce or a complaint stops optional messages to that address | Built |
| 3a | Unsubscribe for reminders: the link in each reminder, its token, the page, the one-click address, and the choice recorded | Built |
| 3b | The reminders on the shared sender. Consent read by the dispatcher waits for the first optional kind in the outbox, and R1 has none | Built |
| 4a | Support: alerts on an enquiry nobody has taken, and on one waiting on Valo past its time | Built |
| 4b | Support: a reply by email to someone who cannot sign in, and its states on the case | Not built |
| 4c | Support: the daily message to the support role's members | Not built |
| 5 | Material notices by email: one message a day to a workspace about the changes that affect it | Built |

## The tests and the pause

The pause is one row for every workspace. Five of the messages' database tests write it: each clears it
as it starts and puts it back as it ends, and two turn it on for a moment to test it. The five ran beside
each other, and beside 24 other files, in the step that proves tenant boundaries.

**What was seen.** On one local run, the log's test failed: a message of its own was "held,
MESSAGES_PAUSED" where the test expected "cancelled, ORDER_NOT_VERIFIED". Run again on the same commit,
the step passed. Other test runs were using the machine during the first run. No hosted run has failed
this way.

**The cause.** While one file has the pause on, the dispatcher holds every message it is asked to offer,
another file's too. It was reproduced directly. With one file's pause kept on for fifteen seconds, the
log's test beside it fails, with a message held that it expected to be accepted. The same two files, run
one after the other with the same pause, pass.

**What changed.**

- The five files run in a step of their own, one file at a time (`test:valo-messages-db`,
  `--test-concurrency=1`), as the source controls' and the incident rehearsal's steps do. The step
  follows the one they were part of, and runs whatever became of it.
- The test inventory fails when a test file that writes a safety switch is run by a script that runs its
  files side by side. It finds a file that writes one through the messages' fixture, through the staff
  action that pauses a service, or in the table itself. A file that writes only its own workspace's
  switch is recorded there with that reason. There is one.
- The inventory takes a script as run in CI only when the workflow calls it, or a script the workflow
  runs calls it. Before, a script that CI never runs vouched for the scripts it names: `test:valo-db`
  names the new script, and would have hidden a missing step.

**What the check does not see.** It reads the test files' own words. A test that wrote a switch through
a helper of another name would not be found.

## The owner's points

1. **A provider and a sender address**, and the approval to send. Until then nothing leaves Valo but the
   development test address. With them, the provider's signing secret for its delivery reports
   (`VALO_EMAIL_WEBHOOK_SECRET`), and the webhook's address entered at the provider.
2. **Replies to an unverified address**: whether staff may reply by email to the address someone gave when
   they could not sign in.
3. **The messages' words**, reviewed before the first real send.
4. **The business details on the PDF receipt**: Valo's name and address as the owner approves them.
5. **How long things are kept**: a settled delivery report for 30 days, and a suppressed address's
   checksum for 180 days after the last report about it. Both are proposals.
6. **The unsubscribe link**: that it never expires while its key is kept, and that one workspace's links
   are taken ten times a minute. Both are proposals. The page's words are among the messages' words in
   point 3.
7. **Notices by email**. All three are proposals, and the message's words are among those in point 3:
   - which notices are emailed: every correction, every changed requirement and a withdrawn
     template, and not a template replaced by a later edition;
   - when: from 07:00 Lagos time the morning after, and a week back at most;
   - that it is a necessary message, which nobody can unsubscribe from.
8. **How long an enquiry may wait** on Valo before its alert: 48 hours with nobody touching it. A
   proposal, and Valo's own aim: no reply time is promised to anyone.
