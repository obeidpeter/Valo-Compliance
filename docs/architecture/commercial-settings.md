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
2. **A price carried to the next edition.** When the owner records a price, they choose whether it
   carries to the template's later editions, and the choice is part of the checksum. When the next
   edition is released, a price that carries is recorded for it, with the same terms and a link to the
   price it came from, and the earlier edition's price closes.
3. **Quotas and the access rule as versioned settings.** A setting is a row with a value, effective
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

## What comes next

Slice 2, a price carried to the next edition.
