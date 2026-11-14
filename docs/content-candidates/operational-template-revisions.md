# Valo operational template revisions

Prepared: 14 November 2026. Revision: candidate-2. Status: **DRAFT — EDP pending; not publication eligible.**

These are complete replacement bodies for the two original operational forms already in the current development publication policy: TPL-07 first, then TPL-06. They retain the inventory titles, R1 release and Free / Download classifications. They are original AI-assisted prose authored in this ChatGPT conversation, revising `analysis/operational-template-candidates.md`; they are not Replit-generated output. No new upstream model or execution receipt is asserted. Provider terms evidence is retained in `analysis/chatgpt-content-provenance-rights.md`; that evidence does not certify these revisions, third-party clearance or customer licence acceptance. Bind the new source and final canonical hashes before review. Do not reuse a prior candidate's rights binding, reviews or exports as if they covered this version.

Only the two `TPL` sections are customer-body candidates. The introduction and publication handoff remain internal. Each section contains its own blank/zero, scope and calculation instructions so importing an individual form does not discard essential instructions from a file header. No statutory duty, retention period, tax rate or regulatory approval is asserted. Final suitability depends on the actual content, intended use and policy.

## TPL-07 — Inventory register

R1 · Free · Download template · No customer AI drafting workflow

**Purpose:** Keep a manual record of quantities received, issued and counted for one stock item at one location. These are optional internal recordkeeping practices to adapt to your workflow. This blank form does not calculate automatically or verify the information entered.

### Set up this sheet

- Business name: [ ]
- Register reference: [ ]
- Period covered: [start date] to [end date]
- Item code and description: [ ]
- Stock location or bin: [ ]
- Unit of measure: [ ]
- Batch or lot reference, if this sheet tracks a specific batch: [ ]
- Person or role maintaining the record: [ ]
- Last updated: [date, time and timezone]

Keep one item, location and unit on this sheet. If a batch is specified, keep its movements separate from other batches. Record pieces, cartons, litres or other units on separate sheets unless a documented conversion has first established one consistent unit for this sheet. Keep the conversion factor and supporting reference with the affected movement. Do not combine unlike quantities in a single balance.

An empty field means not entered, not zero or confirmed. Enter `0` for a known zero quantity. Use `not known` for an unresolved quantity; do not calculate a new balance through that entry until it is resolved. Use the same unit and consistent decimal precision throughout. Record actual dates with the year; include the timezone when times are used.

### Opening balance

- Opening quantity: [ ]
- Opening balance as at: [date, time and timezone]
- Basis: [physical count / previous closing balance / other stated basis]
- Supporting record reference and any uncertainty: [ ]

The opening quantity is the starting balance, not a receipt. Record it once here. Include only movements after the stated opening point in the movement records below. If the opening quantity is not known, resolve it before treating later running quantities as established.

### Movement record

Repeat this record for each movement. Use a different movement reference for each entry and keep entries in the order used to calculate balances. When events share a time, record their sequence. Enter positive or zero quantities for receipts and issues. An adjustment has an explicit `+` or `−` sign and a reason. For a known movement with no receipt, issue or adjustment, enter `0` in that unused quantity field.

| Field | Entry |
|---|---|
| Movement reference and sequence | [ ] |
| Event date, time and timezone | [ ] |
| Date entered, if different | [ ] |
| Description | [ ] |
| Previous running quantity | [ ] |
| Quantity received | [ ] |
| Quantity issued | [ ] |
| Signed adjustment | [ ] |
| Reason and reference for any adjustment | [ ] |
| Running quantity after movement | [ ] |
| Related order, delivery, transfer or other record | [ ] |
| Entered by | [ ] |

New running quantity = previous running quantity + received − issued + signed adjustment. For the first movement, the previous running quantity is the opening quantity; thereafter it is the preceding movement's new running quantity. Check this calculation manually. Do not silently change a negative result to zero; flag it for investigation. For a transfer, record the outward movement on the source sheet and the inward movement on the destination sheet, using a shared transfer reference; do not record both as increases.

### Physical count and reconciliation

- Count reference: [ ]
- Count as at: [date, time and timezone]
- Last movement reference included in the expected balance: [ ]
- Person or role counting: [ ]
- Expected quantity at that point: [ ]
- Quantity actually counted: [ ]
- Difference, counted quantity minus expected quantity: [ ]
- Any movement during the count and how it was reconciled: [ ]
- Explanation or `not yet known`: [ ]
- Follow-up action, responsible person or role, and target date chosen by the business: [ ]
- Status: [open / investigating / resolved with recorded action]

Compare the count and expected balance at the same point in time. Check movements around the count before changing the register. A count difference is an observation; it does not automatically change the running balance. If the business decides to post an adjustment, record it once as a referenced movement with its reason. Do not also replace the balance or add the same difference a second time.

- Adjustment decision and date, if made: [ ]
- Posted movement reference and amount, if posted: [ ]
- Resulting balance after the posted movement: [ ]

### Corrections and closing check

For a mistake, keep the earlier entry identifiable and record the correction reference, reason, person and date. Check subsequent running balances affected by that correction; do not add a separate correction again if it has already been included.

- Correction reference and affected entry, if any: [ ]
- What changed, why, by whom and when: [ ]
- Closing balance as at the chosen period end: [ ]
- Unresolved differences or incomplete entries: [ ]
- Next sheet reference, if carried forward: [ ]

Before closing, check the item, unit, location, movement sequence, duplicate references, transfers and adjustments. Carry a confirmed closing quantity into the next sheet as its opening quantity, not as a new receipt. Keep confidential supporting records in the business's chosen controlled location; use references here rather than passwords, payment credentials or identity documents.

**Scope and limitations:** This records user-entered stock quantities. It does not establish ownership, accounting value, product approval, safe condition, fitness for use or compliance with a sector's recordkeeping requirements. It is not a spreadsheet, accounting system or regulated-sector register.

## TPL-06 — Expense claim form

R1 · Free · Download template · No customer AI drafting workflow

**Purpose:** Record expenses a person asks the business to reimburse and distinguish the request, the internal decision and payments actually made. This form does not automatically approve expenses, prove payment or decide tax treatment.

### Claim details

- Business name: [ ]
- Claim reference: [ ]
- Person submitting the claim: [ ]
- Team or project, if relevant: [ ]
- Period covered: [start date] to [end date]
- Date submitted: [ ]
- Claim currency: [ ]
- Contact method for questions, if needed: [ ]
- Funding and payment figures below are current as at: [date, time and timezone]

Use one currency for this claim. If an expense was paid in another currency, resolve and document the conversion outside this form before including a claim-currency amount, or keep a separate claim. Retain the original amount/currency, conversion rate, rate date/basis and converted amount in its supporting record. Both amount columns and all totals use the claim-currency amounts displayed on the form. This form supplies no exchange rate. Include the year in dates. An empty field means not entered; enter `0` only where the amount is known to be zero. Leave unresolved amounts visibly incomplete and do not present an incomplete total as final.

### Expense line

Repeat this record for each expense. Amount requested means the portion of that expense requested from the business **before** subtracting advances or previous reimbursements in the summary. Do not subtract an advance on a line and then subtract it again below.

| Field | Entry |
|---|---|
| Line reference | [ ] |
| Expense date | [ ] |
| Supplier or payee | [ ] |
| Expense description and business purpose | [ ] |
| Project or category, if used | [ ] |
| Amount actually paid, in claim currency | [ ] |
| Amount requested, in claim currency | [ ] |
| Explanation of any difference | [ ] |
| Supporting-record reference or `unavailable` | [ ] |
| Prior claim reference, if this expense was claimed before | [ ] |

Check previous claims before submitting a line again. Where a supporting record is unavailable, say so; do not invent a receipt or payment reference. Record only the amount relating to this claim, with an explanation for any excluded portion.

### Funding already allocated to this claim

Record each funding reference once. An advance is money provided before settlement; a reimbursement is a separate repayment of claimed expenses. The same transfer must not appear in both categories.

| Field | Entry |
|---|---|
| Funding reference and date | [ ] |
| Category: advance or reimbursement | [ ] |
| Amount originally received | [ ] |
| Portion returned or already applied elsewhere | [ ] |
| Remaining portion allocated to this claim | [ ] |
| Reference or explanation supporting this allocation | [ ] |

Repeat the funding record where necessary. Do not allocate the same money to two claims. If a refund, return or prior allocation is unresolved, flag it before completing the balance calculation.

### Request summary

- A — Total of expense-line amounts requested: [ ]
- B — Total remaining advance amounts allocated to this claim: [ ]
- C — Total previous reimbursement amounts allocated to this claim: [ ]
- Requested balance, A − B − C: [ ]
- Missing amounts or unresolved allocations: [ ]

For B and C, sum only the remaining portions allocated to this claim in the relevant category, not the original amounts received.

A positive balance is an amount requested, not an approved payment. A zero balance means no further amount is requested on these figures. A negative balance flags an amount to reconcile; it is not by itself an admission that money is owed. Check the allocations and record the agreed next action. This form does not infer tax deductibility, recoverable tax or the treatment of any expense.

### Internal decision

- Status: [draft / submitted / more information requested / approved in part / approved / declined / withdrawn]
- Person making the decision and date, if decided: [ ]
- Approved expense total **before** funding deductions, if decided: [ ]
- Adjustment or decline reason, if any: [ ]
- Questions or missing records: [ ]
- Approved balance using the same funding snapshot: approved expense total − B − C = [ ]
- Reconciliation action for a negative balance or other discrepancy: [ ]

Keep the requested and approved figures distinct. If the funding snapshot changes, update its dated records and recalculate; do not use a previous balance as if it already includes a new payment.

### Settlement update

- Payment or return actually made, if any: [type, date, amount and reference]
- Person recording the update and date: [ ]
- Updated funding record reference: [ ]
- Remaining approved balance after updating the funding records: [ ]
- Outstanding question or follow-up: [ ]

A new reimbursement belongs in the reimbursement funding records before recalculating the remaining balance. A returned advance changes the amount still allocated; record the return and its reference instead of treating it as an expense. Do not mark a proposed transfer as paid.

**Before sharing:** Check currency, arithmetic, duplicate expenses, duplicate funding references and any previous claim. Remove unnecessary personal information. Use supporting-record references rather than passwords, bank-card information or identity documents. An internal approval field records a business decision only when that decision actually occurred.

## Publication handoff — internal only

Do not copy this section into a customer's form. Preserve the required EDP-008 release notice verbatim: **“AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist.”** Place the following explanation immediately beside it on the eligible detail page and exports: **“Review here means automated AI factual checking and a separate AI challenge. It is not human or professional review.”** These are release-status statements: the drafts above have not passed those reviews. Both statements must be part of the exact canonical version examined by the reviewers and exported for inspection; publishing them requires both real passing reviews and all other gates, not a later unreviewed text change.

Keep evidence provenance in the internal rights/review package. Both the eligible detail page and exports must show the actual source-check date, scope, material limitations and the distinction between this blank business form and general guidance. For these original operational forms, label the date precisely: **“Source-check date — file integrity and provider permission only: [actual server-bound check time].”** A provider-permission check is not legal or regulatory verification. The existing v6 wording already distinguishes those checks from legal verification; do not fabricate another check date, authorship certification or upstream run ID.

Use the actual policy, fresh permitted evidence, immutable candidate hash and separate reviews. Re-render and inspect both formats, including writing space and pagination; these Markdown tables are body specifications, not export evidence. Changing either body invalidates prior review and export bindings. Reuse of the already-recorded provider terms is only appropriate with a newly checked source binding and fresh evidence where policy requires it. Nothing here authorises a quota increase, bypasses a hold, accepts sales terms, counts an eligible template or enables public launch.
