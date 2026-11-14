# Valo additional operational templates — group A

Prepared: 14 November 2026 · Candidate version 1 · Original prose and field specifications, not application code.

## Internal handoff metadata

This file contains complete original candidates for six specified free R1 guided templates: **TPL-01 Invoice; TPL-02 Quotation; TPL-03 Receipt; TPL-04 Purchase order; TPL-05 Delivery note; TPL-08 Meeting minutes**. The IDs, titles, access and workflow flags match `content_inventory.json`. Invoice and Quotation are also authorised customer AI tasks; Receipt, Purchase order, Delivery note and Meeting minutes are guided manual workflows, not additional customer AI tasks.

**Publication state: DRAFT / HELD pending EDP-001–012.** No executed factual/challenge review, rights clearance, publication, legally valid tax treatment or inspected export is claimed. These are original operational structures authored from the user brief and TRD. Applicable authoring-provider terms, permissions, exact candidate hashes, separate reviews, validation and actual DOCX/PDF inspection still need to be retained. Do not count them as eligible catalogue items before that work is complete.

Only each **Customer form** section is the proposed customer document body. Field specifications, examples, review notes, metadata and authoring paths belong to internal records or clearly labelled help/sample views. Do not put them into a customer's final document. No filled example may become a user's saved field value automatically. Names, transactions, dates and references in examples are expressly synthetic, not genuine businesses, payment evidence or acknowledgements.

### Shared guided-field requirements

- Every document retains its template ID/version, customer document ID, saved revision and actual created/updated metadata. Preview and both export formats use that same saved revision. These system values are not fabricated text fields.
- Text values are user-supplied facts, not inferred legal names, registration numbers, authority, acceptance or signatures. Do not invent contact details, tax information or payment instructions. No electronic signature execution is introduced.
- Distinguish **not entered**, **unknown**, **not applicable by explicit choice**, and an actual entered value. Zero is a value only when deliberately supplied or correctly calculated; it is not a replacement for missing information.
- A final customer document cannot hide a missing mandatory fact. Either block final export and show the field error, or offer a deliberately labelled **INCOMPLETE DRAFT — NOT READY TO SEND** export. Unresolved tax inputs must never disappear in a way that implies an exemption.
- Money uses one explicitly selected currency per document. NGN values display the naira symbol and two decimal places. Calculate in decimal-safe arithmetic; do not ask a model to determine totals. For these candidate layouts, round each line amount to the currency's supported minor unit using a documented consistent rule, then sum displayed line amounts. The rounding rule is a product calculation convention, not a legal rule.
- Quantity is a positive decimal with a named unit; monetary unit price/amount is non-negative. A zero-priced item needs an explicit user choice. Reject non-finite, malformed or unsupported-precision values rather than silently changing them. No exchange-rate conversion is inferred.
- Free-text notes cannot override numeric totals or state that an event happened merely because a form was generated. A model may help with the two authorised tasks only within the selected supplied fields and schema.
- Display required source-check/scope/AI-review disclosures only in the form supported by the actual completed publication manifest. Do not claim this draft has already been reviewed. Keep business payment acknowledgement distinct from Valo's own purchase receipt.
- Monetary, item and action tables below are content specifications. Exports need deliberately designed A4 layouts, readable repeated headings and wrapping; Markdown is not proof of print readiness.

---

## TPL-01 — Invoice

R1 · Free · Guided + customer AI · Candidate class: original business transaction record without statutory tax-invoice claims.

**Purpose:** State the amount a business requests for identified goods or work, using facts supplied by the business. This template does not determine tax status or establish that payment has arrived.

### Guided field specification

| Field or group | Value type | Required or conditional rule |
|---|---|---|
| Seller name; seller contact/address for this transaction | Text | Name required. At least one actual contact or address required for a ready-to-send document. No legal suffix inferred. |
| Customer name; billing contact/address | Text | Name required. Billing contact/address optional unless the user's own transaction requires it; missing party identity remains visible. |
| Invoice reference; issue date | Text; date | Required. Reference identifies this document; duplicate references in the business's records should be flagged without rewriting them. |
| Related quotation/order/project reference | Text | Optional; use only a genuine supplied reference. |
| Currency | Currency selection | Required; one supported currency. |
| Item description; quantity; unit; unit price | Repeating structured rows | At least one row. All four fields required per included row. |
| Line amount and subtotal | Calculated money | Line amount = quantity × unit price; subtotal = sum of displayed line amounts. Not model-editable. |
| Agreed discount amount and description | Money; text | Optional. If selected, both required; discount cannot exceed the subtotal in this layout. A percentage is not guessed. |
| Additional agreed charge description and amount | Repeating text/money pairs | Optional; each included charge needs both values. Exclude tax from this list when shown separately. |
| Tax display choice | Explicit choice | No tax line requested / user-supplied tax line / unresolved. Choice concerns document preparation and is not a legal determination. Unresolved requires incomplete-draft handling. |
| Tax label, amount and basis/reference | Text; money; text | Required only when a tax line is included. Enter the validated transaction-specific inputs. If a rate and base are supplied, independently check their arithmetic; never infer the rate or liability. |
| Grand total | Calculated money | Subtotal − discount + additional charges + explicitly supplied tax amount, if any. |
| Prior amount received against this invoice; payment date/reference | Money; date/text | Optional. Include only after the issuer confirms this is an actual payment they recorded, not an expected payment. |
| Remaining balance or excess recorded | Calculated money | Grand total − prior amount received. A negative result is labelled an excess to reconcile, not a negative amount the customer is told to pay. |
| Payment due date; basis of date | Date; text/confirmation | Optional. Include only a date actually agreed or chosen by the issuer and labelled accurately. Flag dates before issue for clarification. No deadline inferred from law. |
| Payment instructions | Text | Optional, user-entered and verified through the business's own process. Never generate account numbers or payment links. |
| Notes | Bounded text | Optional; no added penalties, legal threats, invented guarantees or signatures. |

### Customer form

# INVOICE

**[Seller name]**  
[Seller contact/address]

**Bill to:** [Customer name]  
[Billing contact/address, if supplied]

| Invoice reference | Issue date | Currency |
|---|---|---|
| [Invoice reference] | [Issue date] | [Currency] |

Related order, quotation or project: [Reference, if supplied]  
Payment date: [Confirmed date and accurate label, if supplied]

| Description | Quantity | Unit | Unit price | Line amount |
|---|---:|---|---:|---:|
| [Goods or work supplied / agreed billing description] | [ ] | [ ] | [ ] | [Calculated] |
| [Additional item, if any] | [ ] | [ ] | [ ] | [Calculated] |

| Amount summary | Amount |
|---|---:|
| Subtotal | [Calculated] |
| [Agreed discount description, if any] | [Discount shown as deduction] |
| [Additional agreed charge, if any] | [ ] |
| [User-supplied tax label, only if supported inputs were entered] | [ ] |
| **Invoice total** | **[Calculated]** |
| Amount already received and recorded by issuer, if any | [ ] |
| **Balance requested / excess recorded for reconciliation** | **[Calculated and correctly labelled]** |

**Payment instructions**  
[Verified instructions supplied by the issuer, if included]

**Transaction notes**  
[Supplied notes, scope or reference information]

Please contact [Seller contact] with the invoice reference if any detail needs clarification.

*This invoice is prepared from information supplied by the issuer. It is not a receipt or independently verified evidence that payment has been received. No government tax-invoice status is claimed by this template.*

### Synthetic filled example — never preload into customer records

**SAMPLE ONLY — NOT A REAL INVOICE**

Seller: Riverleaf Office Supplies — fictional sample business. Contact: sample correspondence reference SELLER-DEMO. Customer: Cedar Lane Studio — fictional sample business. Invoice: DEMO-INV-001. Issue date: 12 November 2026. Currency: NGN. Related order: DEMO-PO-001. Due date: 19 November 2026, stated as the fictional parties' agreed date.

| Description | Quantity | Unit | Unit price | Line amount |
|---|---:|---|---:|---:|
| Plain notebooks | 3 | pieces | ₦2,000.00 | ₦6,000.00 |
| Desk folders | 2 | pieces | ₦1,500.00 | ₦3,000.00 |

Subtotal ₦9,000.00; supplied agreed discount ₦500.00; supplied delivery charge ₦1,000.00; no tax line selected for this synthetic example, with no conclusion about tax liability. Invoice total **₦9,500.00**. Synthetic earlier payment recorded by issuer: ₦2,000.00, reference DEMO-PAY-001. Balance requested: **₦7,500.00**. No bank details, registration numbers or signatures are supplied or invented.

**Template-specific review targets:** Tax-display ambiguity; false payment claims; missing party identity; discount bounds; fractional quantities and rounding; overpayment labelling; multi-page item tables; supplied payment instructions remaining unchanged.

---

## TPL-02 — Quotation

R1 · Free · Guided + customer AI · Candidate class: original commercial offer description with no standard legal clauses imposed.

**Purpose:** Describe a proposed supply and its price clearly, including what is included, what is excluded and which assumptions still need confirmation. A quotation is not payment evidence or proof the customer accepted.

### Guided field specification

| Field or group | Value type | Required or conditional rule |
|---|---|---|
| Offering business name and genuine contact | Text | Required. No inferred company status or credentials. |
| Customer name/contact | Text | Name required; contact optional but highlight if needed for the intended use. |
| Quotation reference; issue date; currency | Text; date; selection | Required. |
| Project/request description | Text | Required; describe the actual requested goods or work. |
| Included items: description, quantity, unit, unit price | Repeating structured rows | At least one required row, validated as for Invoice. |
| Subtotal, discount, additional charges, tax and quoted total | Structured/calculated money | Same arithmetic and explicit tax-display rules as Invoice; no payment deduction or balance-received claim. |
| Optional extra items | Separate structured rows | Each extra has its own description, quantity/unit, price and total. Excluded from quoted total unless the user expressly includes it and updates the scope. |
| Included scope; excluded scope | Text/list | Included scope required. Exclusions optional; do not invent legal disclaimers or change the supplied offer. |
| Assumptions/customer inputs | Text/list | Explicitly state supplied assumptions and unanswered questions. Material unresolved price/scope facts block ready-to-send status or require a clearly qualified/incomplete draft. |
| Proposed delivery/completion; dependencies | Text/date | Optional; identify it as proposed/estimated/agreed according to actual facts. No guarantee inferred. |
| Offer-valid-until date | Date | Optional, issuer-chosen. Cannot precede issue date without correction; not labelled a statutory deadline. |
| Payment proposal | Text | Optional, supplied commercial proposal only. No inferred deposit, penalty or interest terms. |
| Contact/response instruction | Text | Required genuine way to discuss/confirm requirements; no fictional electronic acceptance or signature. |

### Customer form

# QUOTATION

**[Offering business name]**  
[Contact/address]

**Prepared for:** [Customer name]  
[Customer contact/address, if supplied]

Quotation reference: [ ]  
Issue date: [ ]  
Currency: [ ]  
Valid until: [Issuer-chosen date, if supplied]

## Your request

[Description of the goods, work or project requested]

## Included in this quotation

| Description | Quantity | Unit | Unit price | Line amount |
|---|---:|---|---:|---:|
| [Included item] | [ ] | [ ] | [ ] | [Calculated] |
| [Included item] | [ ] | [ ] | [ ] | [Calculated] |

| Price summary | Amount |
|---|---:|
| Subtotal | [Calculated] |
| [Agreed/proposed discount, if any] | [Deduction] |
| [Additional included charge, if any] | [ ] |
| [Validated user-supplied tax line, if any] | [ ] |
| **Quoted total** | **[Calculated]** |

## Optional extras — excluded from the quoted total

| Optional item | Quantity and unit | Separate price |
|---|---|---:|
| [Optional extra, if supplied] | [ ] | [ ] |

## Scope and arrangements

- Included work or specification: [ ]
- Not included: [Only supplied exclusions]
- Proposed delivery or completion: [ ]
- Information, material or approval needed from the customer: [ ]
- Other stated assumptions or dependencies: [ ]
- Proposed payment arrangement, if supplied: [ ]

## Next step

Please contact [Genuine contact] quoting [Quotation reference] to confirm your requirements or discuss changes. The price and scope above should be checked again if the requested work changes.

*This quotation describes the issuer's proposed offer. It does not record payment, delivery or customer acceptance. Any later acceptance or agreement should be recorded accurately and linked to the version concerned.*

### Synthetic filled example — never preload into customer records

**SAMPLE ONLY — NOT A REAL OFFER**

Offering business: Paperpath Print Desk — fictional sample business. Customer: Sample Training Group — fictional sample customer. Quotation DEMO-Q-002, issued 12 November 2026, valid until 19 November 2026 by fictional issuer choice. Contact: sample correspondence reference PRINT-DEMO.

Request: 200 A5 training booklets, 12 pages each, black-and-white interior; customer supplies final print-ready artwork.

| Included item | Quantity | Unit | Unit price | Line amount |
|---|---:|---|---:|---:|
| Booklet printing to stated specification | 200 | booklets | ₦600.00 | ₦120,000.00 |
| Local delivery to the supplied sample venue | 1 | delivery | ₦5,000.00 | ₦5,000.00 |

Quoted total: **₦125,000.00**. No discount or tax line is selected in this synthetic example; this is not tax advice. Optional cover-layout service: **₦15,000.00**, expressly excluded from the quoted total. Exclusion: original design work beyond the optional extra. Proposed completion: five business days after final artwork is supplied and the parties confirm the job; this is a fictional commercial estimate, not a guaranteed or statutory timeline. Payment arrangement: not supplied. The example records no acceptance.

**Template-specific review targets:** Optional extras not silently included; quoted arithmetic; unresolved scope visible; validity-date consistency; no invented acceptance or proposed payment terms; long descriptions remain legible.

---

## TPL-03 — Receipt

R1 · Free · Guided manual workflow · Candidate class: user-provided payment acknowledgement.

**Purpose:** Record a payment that the issuer says they actually received. The TRD expressly distinguishes this document from independently verified payment proof. Valo must not fabricate or infer the payment from an invoice, customer message, screenshot or generated draft.

### Guided field specification

| Field or group | Value type | Required or conditional rule |
|---|---|---|
| Issuing business/person name and contact | Text | Required. |
| Receipt reference; date issued | Text; date | Required. Duplicate references should be flagged. |
| Payer name | Text | Required for this candidate ready-to-send layout; do not infer from unrelated records. |
| Amount received; currency | Money; selection | Required; amount strictly greater than zero. No amount derived solely from an invoice balance. |
| Actual date received | Date | Required; future dates cannot be described as already received. Clarify an issue date before receipt date rather than silently changing it. |
| Purpose/description; related invoice/order | Text | Description required; reference optional where none exists. |
| Payment method | Text/choice | Optional: cash, bank transfer, other stated method, or not recorded. Do not invent a bank, account, card detail or processor. |
| Payment reference | Text | Optional; a user-supplied reference, not a platform verification result. No unnecessary account/card data. |
| Receipt basis acknowledgement | Explicit user confirmation | Required before ready-to-send export: issuer confirms the payment stated was actually received according to their records. This records their assertion, not an independent verification. An incomplete draft without that confirmation must instead display “Receipt acknowledgement not yet recorded — not evidence of payment”; it must never contain an affirmative received-payment acknowledgement. |
| Allocation to invoice/order lines | Repeating money/reference pairs | Optional. Allocations sum to no more than amount received; clearly show any unallocated amount. Do not force a false allocation. |
| Invoice total / earlier payments / balance | Money with linked references | Optional only when all relevant amounts and links are supplied and verified by issuer. Do not infer “paid in full” from this receipt alone. |
| Recorded by | Text | Optional actual person/role, not a generated signature or professional certification. |
| Notes | Text | Optional factual clarification; no invented refunds, settlement or approval. |

### Customer form

# RECEIPT

**[Issuing business/person]**  
[Contact/address]

Receipt reference: [ ]  
Date issued: [ ]

**Received from:** [Payer name]

| Payment acknowledged by issuer | Detail |
|---|---|
| Amount received | **[Currency and amount]** |
| Date received | [ ] |
| Payment method, if recorded | [ ] |
| Payment reference, if recorded | [ ] |
| Payment for | [Description] |
| Related invoice or order, if any | [Reference] |

## Allocation, if supplied

| Invoice/order or purpose | Amount allocated |
|---|---:|
| [Reference or purpose] | [ ] |
| Unallocated amount, if any | [Calculated] |

Notes: [Factual notes, if any]  
Recorded by: [Actual name/role, if supplied]

**Issuer acknowledgement:** [Confirmed statement only after the actual user confirmation: “The issuer confirms that the payment described above was received according to their records.” Otherwise the incomplete draft states: “Receipt acknowledgement not yet recorded — not evidence of payment.”]

*Prepared from information supplied by the issuer. Valo has not independently verified this payment. This customer business receipt is separate from a receipt issued for a purchase from Valo.*

### Synthetic filled example — never preload into customer records

**SAMPLE ONLY — NOT PAYMENT EVIDENCE**

Issuer: Riverleaf Office Supplies — fictional sample business. Payer: Cedar Lane Studio — fictional sample customer. Receipt reference DEMO-R-003. Date issued and date received: 13 November 2026. Amount received: **₦2,000.00**. Method: bank transfer as a synthetic input, with no real bank details. Payment reference: DEMO-PAY-003. Purpose: part payment against sample invoice DEMO-INV-001.

Allocation to DEMO-INV-001: **₦2,000.00**. Unallocated amount: **₦0.00**. No full-settlement claim is included. The example's receipt-basis acknowledgement is a demonstration field only and must never be treated as an actual event, real user attestation or proof for a live document.

**Template-specific review targets:** No final receipt without an actual issuer acknowledgement; future-date rejection; partial payment is not full settlement; zero/negative amount rejection; allocation bounds; synthetic previews cannot be mistaken for real receipts; no new customer AI workflow for receipts.

---

## TPL-04 — Purchase order

R1 · Free · Guided manual workflow · Candidate class: operational purchase instruction without imposed contractual clauses.

**Purpose:** Record what a business asks a supplier to provide, the agreed or proposed price and delivery details, and who authorised the instruction. It must not invent supplier acceptance or replace the parties' actual commercial arrangements.

### Guided field specification

| Field or group | Value type | Required or conditional rule |
|---|---|---|
| Buyer business name; purchasing contact | Text | Required actual details. |
| Supplier name; supplier contact | Text | Name required; contact needed where the document is intended to be sent. |
| Purchase order reference; date; currency | Text; date; selection | Required. |
| Related supplier quotation/reference | Text | Optional, supplied only. |
| Items: description/specification, quantity, unit, unit price | Repeating structured rows | Required, at least one. Prices may be explicitly unresolved for an incomplete draft; never silently zero. |
| Line/subtotal/discount/charges/tax/total | Calculated and supplied money | Same stated arithmetic and tax-input rules as Invoice. No payment-received deduction. |
| Delivery destination and contact | Text | Required for goods delivery; for services use service location/remote arrangement instead. Do not invent an address. |
| Requested delivery/service date | Date/text | Optional, labelled requested/confirmed according to actual facts. No past/future date inference. |
| Included specification or scope | Text/list | Required beyond a vague item title where needed to identify the supply. |
| Payment arrangement | Text | Optional; only actual agreed or explicitly proposed terms. No default interest, penalties or payment period. |
| Buyer authorisation record | Text/date and explicit confirmation | Required for ready-to-send use as an authorised order: actual approving person/role/date or actual issuer authority. A draft may show authorisation pending. |
| Supplier response | Text/status/date | Optional actual response: not recorded / clarification requested / acknowledged / other accurately stated response. Do not infer acceptance from document creation. |
| Order revision and change reason | System revision plus text | Preserve prior issued version; record material change reason without silently overwriting the order. |

### Customer form

# PURCHASE ORDER

**Buyer:** [Business name]  
Purchasing contact: [ ]  
[Buyer address, if supplied]

**Supplier:** [Supplier name]  
[Supplier contact/address]

Purchase order reference: [ ]  
Order date: [ ]  
Related quotation: [If supplied]  
Currency: [ ]

## Requested supply

| Description and specification | Quantity | Unit | Unit price | Line amount |
|---|---:|---|---:|---:|
| [ ] | [ ] | [ ] | [ ] | [Calculated] |
| [ ] | [ ] | [ ] | [ ] | [Calculated] |

| Order amount summary | Amount |
|---|---:|
| Subtotal | [Calculated] |
| [Discount, if supplied] | [Deduction] |
| [Additional charge, if supplied] | [ ] |
| [Validated user-supplied tax line, if any] | [ ] |
| **Order total** | **[Calculated]** |

## Delivery or service arrangement

- Deliver to / service location or arrangement: [ ]
- Receiving or service contact: [ ]
- Requested or confirmed date, correctly labelled: [ ]
- Packaging, specification or scope notes supplied by buyer: [ ]
- Agreed or proposed payment arrangement, correctly labelled: [ ]

## Order control

Authorised by: [Actual person/role or issuer authority]  
Authorisation date: [ ]  
Supplier response: [Actual response and date, or “not recorded”]  
Change from earlier version, if any: [ ]

Please use [Purchase order reference] in correspondence and related delivery or billing documents. Contact [Purchasing contact] to clarify any difference before proceeding on changed instructions.

*This document records the buyer's stated purchase instruction. Supplier acceptance, delivery and payment are separate events and are not inferred from its preparation.*

### Synthetic filled example — never preload into customer records

**SAMPLE ONLY — NOT AN AUTHORISED PURCHASE**

Buyer: Sample Workshop One — fictional business. Supplier: Sample Storage Supplies — fictional supplier. PO DEMO-PO-004, dated 12 November 2026. Currency: NGN. Related supplier quotation: DEMO-SQ-014. Contacts: sample correspondence references BUYER-DEMO and SUPPLIER-DEMO.

| Item/specification | Quantity | Unit | Unit price | Line amount |
|---|---:|---|---:|---:|
| Stackable storage box, 20-litre size as quoted | 10 | pieces | ₦8,000.00 | ₦80,000.00 |
| Divider pack for the specified box | 5 | packs | ₦1,200.00 | ₦6,000.00 |

Subtotal **₦86,000.00**; supplied delivery charge **₦4,000.00**; order total **₦90,000.00**. No discount/tax line selected in this synthetic example; no tax conclusion is implied. Delivery arrangement: “Sample receiving point, Abuja — fictional address placeholder”; requested date 16 November 2026. Payment arrangement: not supplied. Authorisation demonstration: “Sample purchasing role, demonstration only.” Supplier response: not recorded. These example values must not authorise spending or create an order in a customer's account.

**Template-specific review targets:** Unresolved prices; buyer authority not invented; correct service-versus-delivery fields; requested versus confirmed dates; no supplier acceptance assumption; revision history and amount arithmetic.

---

## TPL-05 — Delivery note

R1 · Free · Guided manual workflow · Candidate class: operational movement and handover record.

**Purpose:** Describe goods sent and record what was actually received when that information is available. A prepared or dispatched note is not proof of delivery, payment, product quality or regulatory clearance.

### Guided field specification

| Field or group | Value type | Required or conditional rule |
|---|---|---|
| Sending business and contact | Text | Required. |
| Recipient/customer name and destination | Text | Required for a ready-to-use dispatch document. |
| Delivery note reference; preparation date | Text; date | Required. |
| Related order/invoice/reference | Text | Optional supplied link; do not require a fictitious invoice where none exists. |
| Movement status | Explicit choice | Prepared / dispatched / part received / received as recorded / delivery not completed / other accurately described state. A state change requires matching user-supplied event facts. |
| Dispatch date/time/timezone | Date/time | Required only when claiming actual dispatch. Future/planned dispatch is labelled planned and not recorded as completed. |
| Delivery/attempt date/time/timezone | Date/time | Required only when claiming an actual delivery or attempt. Unknown is not the current time by default. |
| Item description/code, unit and quantity sent | Repeating structured rows | At least one row; description/unit required. Quantity sent required for an actual dispatch; planned quantities remain labelled planned. |
| Quantity physically received | Non-negative decimal or not recorded | Optional until handover facts are available; required when claiming a recorded receipt. Zero must be an explicit observation. |
| Quantity accepted; quantity damaged/rejected; reason | Optional non-negative quantities/text | Optional details. Separate physical receipt from acceptance and explain discrepancies. Neither accepted nor damaged/rejected quantity may individually exceed physical receipts. If categories overlap, record and explain the overlap rather than double-counting; an unexplained sum above physical receipts needs clarification. Do not silently modify sent quantities to make totals match. |
| Batch/serial/reference | Text | Optional only where useful and supplied; no automatic product approval implication. |
| Person handing over; person receiving | Text/role | Optional actual recorded identities. Missing acknowledgement remains “not recorded”; do not invent a signature or name. |
| Acknowledgement description/date | Text/date and user confirmation | Optional record of what was actually acknowledged, e.g physical count only. No electronic signature execution. |
| Outstanding quantity or follow-up | Calculated/recorded value plus text | If both sent and received quantities are known, display the difference with context. Over-receipt or inconsistent units needs investigation, not automatic correction. |

### Customer form

# DELIVERY NOTE

**From:** [Sending business]  
[Contact]

**To:** [Recipient/customer]  
Destination: [ ]  
Receiving contact, if supplied: [ ]

Delivery note reference: [ ]  
Prepared on: [ ]  
Related order/invoice: [If supplied]  
Movement status: **[Actual selected status]**

Dispatch: [Actual event date/time, or clearly labelled planned/not recorded]  
Delivery or attempt: [Actual event date/time, or not recorded]

## Goods

| Item and useful reference | Unit | Quantity sent or planned, accurately labelled | Quantity physically received, if recorded |
|---|---|---:|---:|
| [ ] | [ ] | [ ] | [Value or “not recorded”] |
| [ ] | [ ] | [ ] | [Value or “not recorded”] |

## Condition and differences

| Item reference | Accepted quantity, if recorded | Damaged/rejected quantity, if recorded | Difference or issue | Follow-up |
|---|---:|---:|---|---|
| [ ] | [ ] | [ ] | [ ] | [ ] |

Batch/serial references, if supplied: [ ]  
Other delivery notes: [ ]

## Handover record

Handed over by: [Actual name/role, or not recorded]  
Received by: [Actual name/role, or not recorded]  
Acknowledgement and its scope: [Actual acknowledgement, or “not recorded”]  
Acknowledgement date/time: [If recorded]

Outstanding action: [ ]  
Person responsible and user-chosen follow-up date, if agreed: [ ]

*This note reflects the movement and handover facts entered by the issuer. A prepared or dispatched note does not establish completed delivery. Any acknowledgement is limited to what is actually recorded; payment, product fitness and regulatory approval are not established by this document.*

### Synthetic filled example — never preload into customer records

**SAMPLE ONLY — NOT PROOF OF DELIVERY**

From: Sample Storage Supplies — fictional supplier. To: Sample Workshop One — fictional business. Destination: “Sample receiving point, Abuja — fictional address placeholder.” Delivery note DEMO-DN-005, prepared 13 November 2026. Related order DEMO-PO-004. Status: part received, based solely on this synthetic scenario. Dispatch 13 November 2026 at 09:00 Africa/Lagos; receiving record 13 November 2026 at 11:30 Africa/Lagos.

| Item | Unit | Sent | Physically received |
|---|---|---:|---:|
| 20-litre storage boxes | pieces | 10 | 8 |

Recorded in this example: seven boxes accepted, one of the eight received boxes damaged, two sent boxes not received. Difference to investigate: two pieces; damaged item is recorded separately, not subtracted twice. Receiving name and acknowledgement: not recorded. Follow-up: “Ask the supplier to clarify the two missing boxes and the damaged box”; no replacement or refund is claimed. No fabricated signature is added to make the example look complete.

**Template-specific review targets:** Planned versus actual events; absent receipt quantities remain unknown; physical count versus acceptance; partial delivery and damage arithmetic; no fabricated handover acknowledgement; inconsistent units or over-receipt preserved for clarification.

---

## TPL-08 — Meeting minutes

R1 · Free · Guided manual workflow · Candidate class: ordinary internal meeting record, not a statutory board resolution or formal governance minute.

**Purpose:** Capture what was discussed, decided and assigned at an ordinary business meeting. Formal company, board, trustee or regulated-governance requirements need the appropriately scoped enhanced-risk document and evidence; this general template does not assert that they are satisfied.

### Guided field specification

| Field or group | Value type | Required or conditional rule |
|---|---|---|
| Business/team name; meeting title/purpose | Text | Required. |
| Meeting reference; date | Text; date | Required. Do not fabricate a meeting that did not happen. Planned agenda is a separate draft state, not completed minutes. |
| Start/end time and timezone | Time/choice | Optional actual values; end before start needs date/overnight clarification. No duration invented. |
| Location or meeting method | Text | Optional actual information; private meeting links need not appear in shared minutes. |
| Chair/facilitator; note-taker | Text | Optional actual names/roles, not automatic assignments. |
| Attendees; apologies/invited but absent | Separate lists | Record supplied facts. At least one actual attendee or an explicit incomplete record is required; invited people are not presumed present. |
| Agenda/topic, discussion summary | Repeating text groups | At least one topic. Keep facts, proposals and decisions distinct. |
| Decision text and status | Text plus choice | Optional per topic: decided / proposal only / unresolved / deferred. Record only actual decisions; no assumed unanimity or legal quorum. |
| Action description; owner; target date; status | Repeating structured rows | Description required for an action. Owner may be explicitly unassigned; target date may be not agreed. Assigned names/dates require actual agreement. |
| Follow-up/next meeting | Text/date | Optional, supplied and accurately labelled proposed or agreed. |
| Circulation/review status | Choice/date/text | Draft notes / circulated / corrected version / confirmed by named participants as recorded. No automatic approval or signatures. |
| Correction note and prior version | Text plus system version | Preserve historical circulated version; describe a material correction. |

### Customer form

# MEETING MINUTES

**Business/team:** [ ]  
**Meeting:** [Title and purpose]  
Meeting reference: [ ]

Date: [ ]  
Time and timezone: [If recorded]  
Location or method: [ ]  
Facilitator: [If supplied]  
Note-taker: [If supplied]

**Present:** [Actual attendees]  
**Apologies or invited but absent:** [Separate supplied list, if any]

Record status: **[Draft notes / circulated / corrected version / actual recorded confirmation]**

## Topics and outcomes

### [Topic 1]

Discussion summary: [Concise factual summary]

Outcome: [Actual decision, proposal, deferred item or unresolved question, clearly labelled]

### [Topic 2, if needed]

Discussion summary: [ ]

Outcome: [ ]

## Action list

| Action reference | Agreed next action | Owner or “unassigned” | Target date or “not agreed” | Actual status |
|---|---|---|---|---|
| [ ] | [ ] | [ ] | [ ] | [Open / in progress / completed with recorded outcome / deferred] |
| [ ] | [ ] | [ ] | [ ] | [ ] |

## Questions and follow-up

Unresolved questions: [ ]  
Next review or meeting: [Proposed/agreed details, if any]  
Supporting-record references: [ ]

## Record review

Circulated on/to: [Only if actually circulated]  
Corrections requested or made: [ ]  
Confirmed by/date: [Only an actual recorded confirmation; otherwise omit or show not recorded]  
Version/change note: [ ]

*These minutes record the supplied account of an ordinary business meeting. A proposal is not a decision; an action date passing is not evidence of completion. This general template does not certify statutory governance procedure, quorum, approval or a person's signature.*

### Synthetic filled example — never preload into customer records

**SAMPLE ONLY — NOT AN ACTUAL MEETING RECORD**

Team: Sample Workshop One — fictional business. Meeting: weekly stock-planning review. Reference DEMO-MIN-008. Date 12 November 2026; time 10:00–10:25 Africa/Lagos. Method: sample office discussion. Present: Sample Person A and Sample Person B, both fictional. Invited but absent: Sample Person C, fictional. Record status: draft notes.

Topic: storage-box supply. Discussion summary: the sample team compared current stock with a proposed order. Outcome: **decision recorded in the synthetic scenario** — obtain clarification on delivery arrangements before placing a further order. No real approval or spending authority is established.

| Action reference | Next action | Owner | Target date | Status |
|---|---|---|---|---|
| DEMO-A1 | Ask the supplier for a confirmed delivery arrangement | Sample Person A | 16 November 2026, fictional agreed target | Open |
| DEMO-A2 | Compare the physical stock count with the sample register | Unassigned | Not agreed | Open |

Unresolved question: which receiving contact will be available? Next meeting: not agreed. Circulation and confirmation: not recorded. The example deliberately preserves an unassigned action and unknown date instead of inventing them.

**Template-specific review targets:** Attendees versus invitees; proposal versus decision; unassigned actions; unknown dates; no invented circulation/approval/quorum; correction history; ordinary minutes kept separate from formal board resolution TPL-25.

---

## Integration and publication checklist

1. Ingest the six complete customer forms and their typed-field intentions into the canonical saved-document model; preserve IDs and all conditional boundaries.
2. Keep the synthetic examples clearly marked in separate sample/help views. Never treat them as actual business evidence or preload them into a new customer document.
3. Show editable business fields separately from locked explanatory boundaries. Do not discard factual edits, autosave conflicts or missing-field states when generating either export.
4. Execute independent factual and challenge checks on each complete candidate. Review the no-tax-inference, no-invented-payment, no-fabricated-acceptance and no-professional-approval controls specifically.
5. Validate exact arithmetic, dates, unknowns, row/field limits, escaping, permitted formatting, complete disclosures and required placeholders; inspect both real export formats, including long names and multi-page tables.
6. Retain rights evidence for the actual authoring route and customer licence decisions. Original creation alone is not commercial permission.
7. Bind the exact body/schema, policy, rights, reviews and tests in the immutable manifest. Release only through the eligible publisher; none of these authoring notes is a pass record.
