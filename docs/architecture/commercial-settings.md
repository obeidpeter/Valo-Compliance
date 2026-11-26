# Commercial settings

Design for the finishing plan's Phase 3 row "Commercial settings", for ADM-006. It is a proposal under
the owner's delegation of 24 November. Every figure, licence, tax treatment and bundle stays the
owner's to decide: this design builds where the owner records them, not what they are.

The requirement, verbatim from the specification:
- ADM-006: "Version prices, bundles, quotas and access rules with effective dates and a change log.
  Accept: historic orders retain their original terms and values after pricing changes."

The specification's launch model (TRD, "Payments, purchases and entitlement"): "one-off premium
templates and curated bundles, priced in NGN". PAY-010 keeps recurring subscriptions off in R1, and
"Actual template prices, tax treatment, licence wording and refund policy must be approved before live
sales; do not carry sample prices into production."

## What there was

**Prices are versioned, and orders keep their terms.**
- A premium template's price is a row of `valo_prices` for one edition: amount in kobo, licence
  version and text, tax treatment, the owner's approval reference, and effective dates.
- A price's terms never change in place. The only change to a row is closing it, once, from the
  moment it is closed or later (migration `price_change_log`).
- Every insert, close and delete of a price is logged in `valo_price_changes`, which is append-only.
  The staff audit history shows it (audit trail, slice 4).
- An order copies its price's amount, currency, title, licence and tax treatment into its own row
  (`amount_kobo`, `currency`, `line`). An entitlement is checked against the order's own copy and the
  price row it names, which is never changed. So a later price leaves earlier orders as they were.

**The gaps.**
1. **Only a command records a price.** `price:premium` previews the exact terms and their checksum,
   and records them with the approval's author and reference typed in, and the checksum. Only the owner
   decides a price, but nothing checks that the person who ran the command is the owner: the approver
   is a typed name.
2. **A new edition has no price.** A price names one edition. When a Content editor releases the next
   edition of a premium template, the template has no open price for it, so it cannot be bought until
   the owner records the same terms again. A purchase of the earlier edition carries to the new one at
   no further charge (editions, slice 2), so only new buyers are stopped.
3. **Quotas are constants.** The drafting assistant's allowances are numbers in the code: 30 drafts a
   day for each workspace and 120 a day in all. Changing one means a release, with no effective date
   and no record of who decided it.
4. **The access rule is a constant.** A purchase carries to its template's later editions (the owner's
   delegated decision 3, "What a buyer keeps"). The rule is written into a database function, and an
   order does not record which rule it was bought under. A change to the rule would change what every
   earlier buyer holds.
5. **There are no bundles.** The launch model names curated bundles; nothing sells one.

**What is not a commercial setting.** The request limits in `quotaPolicy` (reads, writes, checkout's
ten a minute and a hundred a day) are security controls (SEC-005). They stay constants, changed only
in a reviewed release. The refund policy's version is recorded on each refund request already; its
terms wait on the owner's refund policy.

## The slices

1. **The owner's price screen** (built). In the System area, the development owner records a premium
   template's price, after a preview of the exact terms and their checksum. The owner's own verified
   sign-in is the approval's author. The command stays for recovery.
2. **A price carried to the next edition** (built). When the owner records a price, they choose whether it
   carries to the template's later editions, and the choice is part of the checksum. When the next
   edition is released, a price that carries is recorded for it, with the same terms and a link to the
   price it came from, and the earlier edition's price closes.
3. **Quotas and the access rule as versioned settings** (built). A setting is a row with a value, effective
   dates and the owner's approval, versioned as prices are, with an append-only change log. The
   drafting assistant's two daily allowances and the later-editions rule are its first keys. Each
   order records the access rule it was bought under.
4. **One-off bundles.** A bundle is a curated set of premium templates sold together, once, at one
   price. It is versioned as a price is. Its order copies every template's edition and licence, and
   its settlement grants each one, once.

Each slice keeps the acceptance test of ADM-006 in its own terms: an order made before a change keeps
its amount, terms and what it grants after the change.

## Slice 1: the owner's price screen

**Who.** Only the development owner: development only, an active permanent system role, a sign-in
verified moments ago, and the owner the operator bootstrap named (the same check as the owner's
sign-offs of decisions 0018 and 0020). Anyone else is refused, and the refusal changes nothing.

**What it shows.** The published premium templates from the staff library, each with its edition, its
open price and any price scheduled to start. Read-only, as `price:premium status` is.

**Recording a price.**
- The owner gives the amount in naira, the licence version, the licence text, the tax treatment, the
  start (now or a later time) and where the approval is written.
- The screen shows the exact terms and their checksum, computed by the server as the command computes
  it. Recording sends the checksum back; a figure or word changed since the preview is refused.
- The price is recorded by the code the command uses, in the owner's transaction: the template must be
  published, not overdue for its review and not held; a price cannot start in the past, before a
  scheduled one or after one that already ends.
- The approval reference names the owner's identity, not a typed name.
- The template's open price closes when the new one starts. The price change log records both.

**What does not change.** Checkout still runs only with a test key in development. Recording a price
takes no payment, and no sample price is carried into production.

**How it is built.**
- `GET /admin/owner-prices` lists the templates and their prices. `POST /admin/owner-prices/previews`
  returns the exact terms and their checksum, and writes nothing. `POST /admin/owner-prices` records
  them, given the checksum.
- Each runs the owner's check first. A preview and a recording also need a request from Valo's own
  pages.
- The price is recorded by `recordPremiumPriceIn`, the command's own code, in the owner's transaction.
  Its refusals are safe messages: a malformed term is refused with 422, and a template that cannot be
  priced now, or a checksum that is not of these terms, with 409.
- The approval reference reads "(approved by the development owner, <their sign-in>)".

**Tests.**
- **Over HTTP, in the staff library's database test:**
  - a Content editor, a system operator who is not the owner, and the owner without fresh MFA are
    refused, for reading, previewing and recording;
  - a write from another site, and a malformed amount, are refused;
  - a preview gives the exact terms and their checksum, and writes nothing;
  - a recording whose terms differ from the checksum's is refused, and so is one by another operator;
  - the recorded price names the owner's sign-in as the approval's author;
  - an order made at the first price keeps its amount, licence and tax treatment after the owner's
    next price, which closes the first one once, while the change log keeps both.
- **In the browser, on a phone:**
  - the screen lists each template's prices;
  - it previews a price's exact terms and checksum;
  - a changed term asks for a new preview;
  - it records only the terms previewed, with their checksum;
  - it has no automated WCAG 2.2 AA failure.

## Slice 2: a price carried to the next edition

- The price row gains whether it carries to the template's later editions, and the price it was
  carried from. Both are part of its terms, so the versioning trigger keeps them as they were written.
- The owner chooses at recording. The choice is inside the checksum, so the owner's approval covers it.
- When a Content editor releases the next edition of a premium template, the release, in its own
  transaction, records for the new edition a price with the same amount, licence, tax treatment and
  approval reference, carried from the earlier edition's open price, starting at the release. The
  earlier price closes at the same moment.
- A price that does not carry leaves the new edition without a price, as today, until the owner records
  one.
- An order for the earlier edition keeps its price, terms and amount.
- A carried price carries on: the release after it carries the copy, never the original again.
- A price the owner scheduled for the edition on sale carries too, from its own start. The price on
  sale until then carries with the end it already has; a price closes once, so neither is closed
  again.

**How it is built.**
- Migration `price_carries` adds `carries_to_later_editions`, which is no for every price recorded
  before it, and `carried_from`, with a check that a carried price carries on. The new columns change
  every price row's hash, so the same migration reseeds the prices' history digest (audit trail,
  `valo_history_digest_reseed`).
- Migration `price_carry_on_release` adds `valo_carry_premium_prices`, run by a trigger on the staff
  library when an edition of a premium template becomes published. It records the carried prices in
  the release's own transaction, whatever code releases the edition, with the releasing login's own
  rights. The customer role cannot run it.
- The copy keeps the owner's approval reference as it was written; `carried_from` is the link, so the
  reference stays the same however many editions it is carried to.
- The terms' checksum now includes the choice. A preview made before this change no longer matches,
  so recording it asks for a new preview.
- The `price:premium` command takes `--carries yes` or `--carries no`. On the owner's screen it is a
  checkbox, and the preview says whether the price carries to later editions.

**Tests.**
- **Unit:** the choice is yes or no, anything else is refused, and the checksum changes with it.
- **Over HTTP, in the staff library's database test:**
  - a price that does not carry leaves the next edition without one;
  - the same terms that carry have another checksum, and recording with the other one is refused;
  - at the next release, a price that carries is recorded for the new edition with the same amount,
    licence, tax treatment and approval reference, carried from it, starting when it closes;
  - **ADM-006:** an order made at the earlier edition's price keeps its price, amount, licence and
    edition;
  - the release after that carries the copy, never the original again, and the change log keeps each
    one;
  - a scheduled price carries from its own start, and the price on sale until then keeps its end.
- **On the migrations:** prices recorded before carry nothing and keep their terms, the prices' digest
  still matches, the check refuses a carried price that does not carry on, the trigger is defined as
  written, and the customer role cannot run its function.
- **In the browser, on a phone:** the owner ticks the choice, the preview says the price carries, and
  the recording sends it with the checksum.

## Slice 3: quotas and the access rule as versioned settings

- **A setting** is a row of `valo_commercial_settings`: its key, its value, its effective dates and the
  owner's approval reference. Its value never changes in place; a new value is a new row, and the open
  one closes when it starts, once. Every insert and close is logged in an append-only change log. TRUNCATE
  and deletion are refused, as for every history.
- **The keys** are a closed list in the code, each with a check of its value and a default, which is
  today's constant until the owner records a value:

  | Key | Default | Read by |
  | --- | --- | --- |
  | The drafting assistant's daily allowance for each workspace | 30 | Each drafting request |
  | The drafting assistant's daily allowance in all | 120 | Each drafting request |
  | Whether a purchase carries to its template's later editions | yes | Each new order |

  A value far above today's is refused as a likely typing error, as a price above ₦10,000,000 is.
- **Who.** Only the owner records a value, on the same screen as prices, with the same preview,
  checksum and approval reference. A higher drafting allowance can raise spending on the AI provider,
  which is the owner's to approve.
- **The access rule's history.** A new order records the rule in effect when it was created, and the
  carried-editions function reads each order's own record. An order made before the rule had a record
  carries, as every purchase did when it was made.

It is built in two parts, both built: 3a, the settings and the drafting assistant's two daily allowances,
and 3b, the access rule that each order records.

**Slice 3a: how it is built.**
- Migration `commercial_settings` adds `valo_commercial_settings` and its change log,
  `valo_commercial_setting_changes`. At most one value of a setting has no end, and a value is a whole
  number, none below nought, of a setting the code lists.
- Migration `commercial_setting_guards`:
  - a value never changes in place and is never removed; it closes once, from now or later;
  - each insert and close is logged, and the log is append-only;
  - neither table can be emptied, and both keep a history digest (audit trail). They are new, so their
    digests start empty.
- A customer request reads a setting only through `valo_commercial_setting(key)`, which returns the
  value in effect now and nothing else. The customer role has no privilege on either table.
- The settings, their defaults and the most each accepts are in `modules/commercial-settings`, which
  loads no database client when it is imported. Each most is ten times today's allowance: 300 drafts a
  day for each workspace and 1,200 in all.
- The drafting assistant reads both allowances in the transaction that reserves a draft, and in the
  usage it shows. A recorded value applies to every request from its start.
- `GET /admin/owner-settings`, `POST /admin/owner-settings/previews` and `POST /admin/owner-settings`
  work as the price screen's routes do: only the recently verified development owner, from Valo's own
  pages; a preview of the exact terms and their checksum; a recording given that checksum, with the
  owner's own sign-in as the approval's author. The System area shows the panel below the prices.
- Spending on the AI provider stays bounded by the approved inference budget (decision 0008), which no
  setting changes: a higher allowance only lets more drafts be asked for.

**Slice 3a: tests.**
- **Unit:** each setting with its default and its most; a value is a whole number up to the most; the
  start is now or a time with its offset; the checksum changes with each term, and with nothing else.
- **On the migrations:** both keep every row and add the tables empty; a value outside the check is
  refused; one value at most has no end; a value never changes in place and is never removed, and
  closes once, from now or later; a scheduled value is not in effect before it starts; the change log
  holds each insert and close and is append-only; neither table can be emptied; the customer role reads
  a value through the function and neither table; both digests match their rows.
- **Over HTTP, in the staff library's database test:**
  - a Content editor, a system operator who is not the owner, and the owner without fresh MFA are
    refused;
  - a write from another site, a malformed or far larger value, and an unlisted setting are refused;
  - a preview gives the exact terms and their checksum, and writes nothing;
  - a recording whose terms differ from the checksum's is refused, and so is one by another operator;
  - the recorded value names the owner's sign-in as the approval's author, and a customer request reads
    it in effect;
  - the owner's next value closes it once, the change log keeps both, and the request reads the new one;
  - a value scheduled to start later is listed with its start, and one that would start before it is
    refused.
- **In the browser, on a phone:** the panel lists each setting with its values or its default, previews
  a value's exact terms and checksum, asks for a new preview when the value changes, records only the
  terms previewed, and has no automated WCAG 2.2 AA failure.

**Slice 3b: how it is built.**
- **The rule** is the setting `purchase_carries_to_later_editions`, yes or no, and yes by default. Yes: a
  purchase carries to its template's later editions, at no further charge. No: a purchase covers only the
  edition bought, while it stays released. The owner's panel shows the two answers as a choice, and
  previews and records one as it does a count. Migration `order_access_rule` lets a setting's value be yes
  or no for this key only.
- **Each order records it.** Migration `order_access_rule` adds `valo_orders.carries_to_later_editions`.
  Every order made before it holds none, and carries, as every purchase did when it was made. Migration
  `order_access_rule_guards` adds a trigger: a new order records the rule in effect when it is made, and
  any other value is refused. Nothing changes the rule an order recorded.
- **The buyer sees it and accepts it.** The purchases screen says, for each template on sale, whether
  later editions are included. An order is made only with the rule its buyer was shown
  (`acceptedCarriesToLaterEditions`, as the licence is accepted), and is refused if the owner's rule has
  changed since. Checkout reads the rule under the setting's lock, shared, so a value the owner is
  recording waits for the order, or the order for it. Each order on the screen shows the rule it recorded.
- **What a purchase reaches.** Each reader that carries a purchase to a later edition reads the order's own
  rule: on the staff library, the purchased file, whether a workspace holds a template, a premium form's
  edition, a document's form check and the list of carried editions; on the reviewed route, the purchase
  check of a priced version, the owned editions and the purchases screen's downloads. A purchase that does
  not carry reaches only the edition it bought, and only while that edition is released.
- **What a buyer is told.** A workspace holds an edition when it bought it, or bought an earlier one under
  an order that carries. Who an edition's withdrawal reaches, and its notices, count only those. A
  replacement's notice records whether the workspace's purchase carries to the replacement. If it does
  not, the notice says the purchase covers the earlier version only, the replacement is not included, and
  the earlier version can no longer be downloaded.

**Slice 3b: tests.**
- **Unit:** the rule is yes or no, anything else is refused; its reader gives the answer in effect or the
  default, refuses anything but a yes or a no, and for an order takes the setting's lock before it reads;
  the notice and the order card say what each rule means.
- **On the migrations, tracked and unjournalled:** both keep every row, and every order held before them
  records no rule; a setting's value for the rule is yes or no, and a count stays a whole number; only a
  replacement's notice to a workspace that holds the edition says whether its purchase carries; a new order
  records the rule in effect, refuses any other, and keeps it, while its other changes go through; and each
  reader of a carried purchase, and each writer of an edition's notices, reads the order's own rule.
- **Over HTTP, in the staff library's database test:**
  - while the rule is yes, the purchases screen says so and a purchase records that it carries;
  - once the owner's rule says no, the screen says so, an order that accepts the earlier rule is refused,
    and a new purchase records that it does not carry; each order shows its own rule;
  - at the next edition's release, only the purchase that carries reaches it, the replaced edition is no
    longer released to the other, and each buyer's notice says whether its purchase carries;
  - **ADM-006:** after the owner's rule says yes again, the order made under no keeps its rule and still
    does not reach the new edition, while a purchase made then carries;
  - nothing changes the rule an order recorded.
- **On the reviewed route, in the entitlement test:** an order recorded under no releases the version it
  bought and not a later one, after the rule says yes again, while a purchase made under yes carries.
- **In the browser, on a phone:** checkout says whether later editions are included before the licence is
  accepted, and each order shows the rule it recorded.

## Slice 4: one-off bundles

- **A bundle** is a named, curated set of two or more premium templates, sold once at one price. A
  bundle's version holds its templates, its amount, licence, tax treatment, effective dates and the
  owner's approval reference and checksum, and never changes in place.
- **Buying one.** Checkout offers a bundle only while every template in it is published, not held and
  not overdue. Its order copies, for each template, the edition and the licence it grants. Settlement
  grants one entitlement for each edition, in the same transaction, once (PAY-005).
- **After a change.** A later version of the bundle, or a changed template price, leaves the order's
  templates, editions, amount and licence as they were. Each granted edition carries to later editions
  under the access rule the order recorded.
- **Refunds.** A refund of a bundle's order covers the whole order. Its entitlements end together, and
  drafts made from them stay the customer's (EDT-010).
- **Which bundles exist** is the owner's to decide. Until the owner records one, none is offered.

**Slice 4: how it is built.** In three parts, each with its own pull request.

- **4a, one check of a purchase's terms** (built; moving code, no change of behaviour). Five database readers and
  checkout's list of verified editions each repeat the same check: the order's price names the edition,
  the order's line copies it and the price's licence, and the price carries the owner's approval. A new
  function, `valo_order_terms_hold(order, edition)`, makes that check once, and each reader calls it.
  Who an edition reaches and its notices read no price, and stay as they are. Like every function a
  customer request may call, it runs as its owner; in a request's scope it reads only that workspace's
  orders. Its upgrade check shows the readers call it and read no price of their own, and that it holds
  for the edition and licence an order names and nothing else; the staff library's, the entitlement and
  the commerce tests, unchanged, show each reader behaves as before.
- **4b, versioned bundles and the owner's screen.**
  - `valo_bundles` holds a bundle's versions: a name that stays the same across them, a title, its
    templates, two to ten premium templates from the staff library, each named by its item, so a bundle
    outlives its templates' editions; the amount, licence, tax treatment, the owner's approval reference and
    effective dates. It is versioned as prices are: a version never changes in place, the next one closes
    it when it starts, once, an append-only change log keeps both, and the table keeps a history digest.
    The staff library's premium templates are the only ones the owner prices (slice 1), so they are the
    only ones a bundle holds.
  - The owner records a version on the System area's screen, after a preview of the exact terms and their
    checksum, as for a price. An item that is not a premium template of the staff library is refused.
- **4c, buying a bundle.**
  - Checkout offers a bundle's open version while each of its templates has a released edition that is
    not held and not overdue. The buyer sees the templates it includes, its licence and tax treatment, and
    the access rule, and accepts them as for a template.
  - An order names either a price or a bundle. A bundle's order copies the bundle's licence and, for each
    template, the released edition it grants, with its title. It is refused while the workspace already
    holds one of those editions.
  - Settlement grants one entitlement for each edition, in the same transaction, once (PAY-005); an
    order may now hold one entitlement for each edition it grants.
  - `valo_order_terms_hold` accepts a bundle's order for an edition the order's line names, whose
    item is one of the bundle's, under the bundle's licence and approval.
  - A refund or a dispute covers the whole order, so its entitlements end together; drafts made from them
    stay the customer's (EDT-010). The receipt lists each edition.

## What comes next

Slice 4b, versioned bundles and the owner's screen for them.
