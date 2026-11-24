import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import { readTemplateIntake } from "../publication";

/**
 * The annotation maps of the retained drafts (forms v2, docs/architecture/forms-v2.md): each turns a
 * template's hash-checked retained draft into the form text proposed for its fill-in form. A staff
 * action files that text as a private draft version in the staff library; a Content editor previews
 * it and releases it, or not. Nothing here is released.
 *
 * A change names text that occurs exactly once in the draft as the earlier changes leave it. Most
 * name a placeholder's slot or take out Markdown's emphasis marks, which form text does not print. A
 * change that leaves words out, or keeps them only for one answer, says why: these are the edits the
 * owner reviews (point 2 of the design note). A test shows that the text adds no words: for every
 * combination of answers to its choices, with its slots left empty, it prints only the draft's words,
 * in the draft's order.
 */
/**
 * A change to a draft. `moves` marks one that places the draft's own words elsewhere, as a payment
 * reminder's timing paragraph moves from the draft's choices into the letter: it says why.
 */
export type FormTextChange = { from: string; to: string; why?: string; moves?: true };

export const FORM_TEXT_MAPS: Readonly<Partial<Record<GuidedTemplateId, readonly FormTextChange[]>>> = {
  "TPL-01": [
    {
      from: "**[Seller name]**  \n[Seller contact/address]",
      to: "[Seller name]{=issuerName}\n[Seller contact/address]{=issuerAddress}",
    },
    {
      from: "**Bill to:** [Customer name]  \n[Billing contact/address, if supplied]",
      to: "Bill to: [Customer name]{=recipientName}\n{?recipientAddress}[Billing contact/address, if supplied]{=recipientAddress}{/?}",
      why: "The customer's address is optional: it prints once it is given.",
    },
    {
      from: "| [Invoice reference] | [Issue date] | [Currency] |",
      to: "| [Invoice reference]{=documentNumber} | [Issue date]{=issueDate} | [Currency]{=calc.currency} |",
    },
    {
      from: "Related order, quotation or project: [Reference, if supplied]  \nPayment date: [Confirmed date and accurate label, if supplied]",
      to: "{?relatedReference}Related order, quotation or project: [Reference, if supplied]{=relatedReference}{/?}\nPayment date: [Confirmed date and accurate label, if supplied]{=dueDate}",
      why: "The related reference is optional: its line prints once it is given.",
    },
    {
      from: "| [Goods or work supplied / agreed billing description] | [ ] | [ ] | [ ] | [Calculated] |\n| [Additional item, if any] | [ ] | [ ] | [ ] | [Calculated] |",
      to: "| {*items} [Goods or work supplied / agreed billing description]{=items.description} | [ ]{=items.quantity} | [ ]{=calc.unit} | [ ]{=items.unitPriceKobo} | [Calculated]{=calc.lineAmount} |",
      why: "One row prints for each item the form lists, so the draft's second sample row goes.",
    },
    { from: "| Subtotal | [Calculated] |", to: "| Subtotal | [Calculated]{=calc.subtotal} |" },
    {
      from: "| [Agreed discount description, if any] | [Discount shown as deduction] |",
      to: "| {?discountMode=supplied}Agreed discount | [Discount shown as deduction]{=calc.discount}{/?} |\n| {?discountMode=}[Agreed discount description, if any] | [Discount shown as deduction]{/?} |",
      why: 'The discount row prints only when a discount is supplied, labelled "Agreed discount" from the draft\'s own words, since the form asks for no description; it prints as the draft has it while the question is unanswered.',
    },
    {
      from: "| [Additional agreed charge, if any] | [ ] |\n",
      to: "",
      why: "The form asks for each agreed charge as an item line of its own, as its items table says, so this row goes.",
    },
    {
      from: "| [User-supplied tax label, only if supported inputs were entered] | [ ] |",
      to: "| {?taxMode=supplied}[User-supplied tax label, only if supported inputs were entered]{=taxLabel} | [ ]{=taxAmountKobo}{/?} |\n| {?taxMode=}[User-supplied tax label, only if supported inputs were entered] | [ ]{/?} |",
      why: "The tax row prints only when a tax amount and label are supplied; it prints as the draft has it while the question is unanswered.",
    },
    {
      from: "| **Invoice total** | **[Calculated]** |\n| Amount already received and recorded by issuer, if any | [ ] |\n| **Balance requested / excess recorded for reconciliation** | **[Calculated and correctly labelled]** |",
      to: "| Invoice total | [Calculated]{=calc.total} |",
      why: "The form records no amount already received (the payment reminder form records payments), so the invoice total is the amount requested and the two rows after it go.",
    },
    {
      from: "**Payment instructions**  \n[Verified instructions supplied by the issuer, if included]",
      to: "{?paymentInstructions}\nPayment instructions\n[Verified instructions supplied by the issuer, if included]{=paymentInstructions}\n{/?}",
      why: "Payment instructions are optional: they print, with their heading, once they are given.",
    },
    {
      from: "**Transaction notes**  \n[Supplied notes, scope or reference information]",
      to: "Transaction notes\n[Supplied notes, scope or reference information]{=billingBasis}\n\n{?taxMode=supplied}[ ]{=taxBasis}{/?}\n\n{?notes}[ ]{=notes}{/?}",
      why: "The billing basis fills the notes. The basis of a supplied tax amount, and the optional notes once given, each print below it as a paragraph of their own, so that no paragraph can grow past what a document block holds.",
    },
    { from: "Please contact [Seller contact] with", to: "Please contact [Seller contact]{=issuerName} with" },
    {
      from: "*This invoice is prepared from information supplied by the issuer. It is not a receipt or independently verified evidence that payment has been received. No government tax-invoice status is claimed by this template.*",
      to: "This invoice is prepared from information supplied by the issuer. It is not a receipt or independently verified evidence that payment has been received. No government tax-invoice status is claimed by this template.",
    },
  ],
  "TPL-02": [
    {
      from: "**[Offering business name]**  \n[Contact/address]",
      to: "[Offering business name]{=issuerName}\n[Contact/address]{=issuerAddress}",
    },
    {
      from: "**Prepared for:** [Customer name]  \n[Customer contact/address, if supplied]",
      to: "Prepared for: [Customer name]{=recipientName}\n{?recipientAddress}[Customer contact/address, if supplied]{=recipientAddress}{/?}",
      why: "The customer's address is optional: it prints once it is given.",
    },
    {
      from: "Quotation reference: [ ]  \nIssue date: [ ]  \nCurrency: [ ]  \nValid until: [Issuer-chosen date, if supplied]",
      to: "Quotation reference: [ ]{=documentNumber}\nIssue date: [ ]{=issueDate}\nCurrency: [ ]{=calc.currency}\n{?validUntil}Valid until: [Issuer-chosen date, if supplied]{=validUntil}{/?}",
      why: "The date the quotation is valid until is optional: its line prints once it is given.",
    },
    {
      from: "[Description of the goods, work or project requested]",
      to: "[Description of the goods, work or project requested]{=scope}",
    },
    {
      from: "| [Included item] | [ ] | [ ] | [ ] | [Calculated] |\n| [Included item] | [ ] | [ ] | [ ] | [Calculated] |",
      to: "| {*items} [Included item]{=items.description} | [ ]{=items.quantity} | [ ]{=calc.unit} | [ ]{=items.unitPriceKobo} | [Calculated]{=calc.lineAmount} |",
      why: "One row prints for each item the form lists, so the draft's second sample row goes.",
    },
    { from: "| Subtotal | [Calculated] |", to: "| Subtotal | [Calculated]{=calc.subtotal} |" },
    {
      from: "| [Agreed/proposed discount, if any] | [Deduction] |",
      to: "| {?discountMode=supplied}Agreed discount | [Deduction]{=calc.discount}{/?} |\n| {?discountMode=}[Agreed/proposed discount, if any] | [Deduction]{/?} |",
      why: 'The discount row prints only when a discount is supplied, labelled "Agreed discount" from the draft\'s own words, since the form asks for no description; it prints as the draft has it while the question is unanswered.',
    },
    {
      from: "| [Additional included charge, if any] | [ ] |\n",
      to: "",
      why: "The form asks for each charge as an item line of its own, as its items table says, so this row goes.",
    },
    {
      from: "| [Validated user-supplied tax line, if any] | [ ] |",
      to: "| {?taxMode=supplied}[Validated user-supplied tax line, if any]{=taxLabel} | [ ]{=taxAmountKobo}{/?} |\n| {?taxMode=}[Validated user-supplied tax line, if any] | [ ]{/?} |",
      why: "The tax row prints only when a tax amount and label are supplied; it prints as the draft has it while the question is unanswered.",
    },
    {
      from: "| **Quoted total** | **[Calculated]** |",
      to: "| Quoted total | [Calculated]{=calc.total} |\n\n{?taxMode=supplied}[ ]{=taxBasis}{/?}",
      why: "The basis of a supplied tax amount prints below the price summary, as a paragraph of its own.",
    },
    {
      from: "## Optional extras \u2014 excluded from the quoted total\n\n| Optional item | Quantity and unit | Separate price |\n|---|---|---:|\n| [Optional extra, if supplied] | [ ] | [ ] |\n\n",
      to: "",
      why: 'The form asks for exclusions and optional extras in one answer, printed under "Not included", and asks no price for an extra, so this table goes.',
    },
    {
      from: "- Included work or specification: [ ]\n- Not included: [Only supplied exclusions]\n- Proposed delivery or completion: [ ]\n- Information, material or approval needed from the customer: [ ]\n- Other stated assumptions or dependencies: [ ]\n- Proposed payment arrangement, if supplied: [ ]",
      to: "- {?exclusions}Not included: [Only supplied exclusions]{=exclusions}{/?}\n\n- Proposed delivery or completion: [ ]{=acceptance}\n\n- {?customerInputs}Information, material or approval needed from the customer: [ ]{=customerInputs}{/?}\n\n- {?assumptions}Other stated assumptions or dependencies: [ ]{=assumptions}{/?}\n\n- {?paymentArrangement}Proposed payment arrangement, if supplied: [ ]{=paymentArrangement}{/?}",
      why: 'The form asks for the request and what it includes in one answer, printed under "Your request", with the included items in the table, so the first line goes. Each other line prints once it is answered, the delivery arrangement always, since the form requires it; each is a list of its own, so that no list can grow past what a document block holds.',
    },
    {
      from: "Please contact [Genuine contact] quoting [Quotation reference] to confirm",
      to: "Please contact [Genuine contact]{=issuerName} quoting [Quotation reference]{=documentNumber} to confirm",
    },
    {
      from: "*This quotation describes the issuer's proposed offer. It does not record payment, delivery or customer acceptance. Any later acceptance or agreement should be recorded accurately and linked to the version concerned.*",
      to: "This quotation describes the issuer's proposed offer. It does not record payment, delivery or customer acceptance. Any later acceptance or agreement should be recorded accurately and linked to the version concerned.",
    },
  ],
  "TPL-03": [
    {
      from: "**[Issuing business/person]**  \n[Contact/address]",
      to: "[Issuing business/person]{=issuerName}\n[Contact/address]{=issuerAddress}",
    },
    {
      from: "Receipt reference: [ ]  \nDate issued: [ ]",
      to: "Receipt reference: [ ]{=documentNumber}\nDate issued: [ ]{=issueDate}",
    },
    { from: "**Received from:** [Payer name]", to: "Received from: [Payer name]{=recipientName}" },
    {
      from: "| Amount received | **[Currency and amount]** |",
      to: "| Amount received | [Currency and amount]{=receivedKobo} |",
    },
    { from: "| Date received | [ ] |", to: "| Date received | [ ]{=paymentDate} |" },
    {
      from: "| Payment method, if recorded | [ ] |",
      to: "| Payment method, if recorded | [ ]{=paymentMethod} |",
    },
    {
      from: "| Payment reference, if recorded | [ ] |",
      to: "| Payment reference, if recorded | [ ]{=paymentReference} |",
    },
    {
      from: "| Payment for | [Description] |\n| Related invoice or order, if any | [Reference] |",
      to: "\nPayment for: [Description]{=purpose}\n{?relatedReference}Related invoice or order, if any: [Reference]{=relatedReference}{/?}",
      why: "What the payment was for can be longer than a table cell holds, so it prints below the table, with the related reference after it as in the draft. The related reference is optional: its line prints once it is given.",
    },
    {
      from: "## Allocation, if supplied\n\n| Invoice/order or purpose | Amount allocated |\n|---|---:|\n| [Reference or purpose] | [ ] |\n| Unallocated amount, if any | [Calculated] |\n\n",
      to: "",
      why: 'The form asks for what the payment was for and any known allocation in one answer, printed under "Payment for", and asks no amount by allocation, so this section goes.',
    },
    {
      from: "Notes: [Factual notes, if any]  \nRecorded by: [Actual name/role, if supplied]",
      to: "{?notes}Notes: [Factual notes, if any]{=notes}{/?}\n{?recordedBy}Recorded by: [Actual name/role, if supplied]{=recordedBy}{/?}",
      why: "The notes and who recorded the payment are optional: each line prints once it is given.",
    },
    {
      from: "**Issuer acknowledgement:** [Confirmed statement only after the actual user confirmation: \u201cThe issuer confirms that the payment described above was received according to their records.\u201d Otherwise the incomplete draft states: \u201cReceipt acknowledgement not yet recorded \u2014 not evidence of payment.\u201d]",
      to: "Issuer acknowledgement: {?acknowledgement=yes}The issuer confirms that the payment described above was received according to their records.{/?}{?acknowledgement=}Receipt acknowledgement not yet recorded \u2014 not evidence of payment.{/?}",
      why: "The statement that the payment was received prints only once the business confirms it; until then the receipt prints the statement the draft gives for an incomplete one. The draft's directions around them are for the form, not wording of the receipt.",
    },
    {
      from: "*Prepared from information supplied by the issuer. Valo has not independently verified this payment. This customer business receipt is separate from a receipt issued for a purchase from Valo.*",
      to: "Prepared from information supplied by the issuer. Valo has not independently verified this payment. This customer business receipt is separate from a receipt issued for a purchase from Valo.",
    },
  ],
  "TPL-04": [
    {
      from: "**Buyer:** [Business name]  \nPurchasing contact: [ ]  \n[Buyer address, if supplied]",
      to: "Buyer: [Business name]{=issuerName}\n{?purchasingContact}Purchasing contact: [ ]{=purchasingContact}{/?}\n[Buyer address, if supplied]{=issuerAddress}",
      why: "The purchasing contact is optional: its line prints once it is given.",
    },
    {
      from: "**Supplier:** [Supplier name]  \n[Supplier contact/address]",
      to: "Supplier: [Supplier name]{=recipientName}\n{?recipientAddress}[Supplier contact/address]{=recipientAddress}{/?}",
      why: "The supplier's address is optional: it prints once it is given.",
    },
    {
      from: "Purchase order reference: [ ]  \nOrder date: [ ]  \nRelated quotation: [If supplied]  \nCurrency: [ ]",
      to: "Purchase order reference: [ ]{=documentNumber}\nOrder date: [ ]{=issueDate}\n{?relatedQuotation}Related quotation: [If supplied]{=relatedQuotation}{/?}\nCurrency: [ ]{=calc.currency}",
      why: "The related quotation is optional: its line prints once it is given.",
    },
    {
      from: "| [ ] | [ ] | [ ] | [ ] | [Calculated] |\n| [ ] | [ ] | [ ] | [ ] | [Calculated] |",
      to: "| {*items} [ ]{=items.description} | [ ]{=items.quantity} | [ ]{=calc.unit} | [ ]{=items.unitPriceKobo} | [Calculated]{=calc.lineAmount} |",
      why: "One row prints for each item the form lists, so the draft's second sample row goes.",
    },
    { from: "| Subtotal | [Calculated] |", to: "| Subtotal | [Calculated]{=calc.subtotal} |" },
    {
      from: "| [Discount, if supplied] | [Deduction] |",
      to: "| {?discountMode=supplied}Discount | [Deduction]{=calc.discount}{/?} |\n| {?discountMode=}[Discount, if supplied] | [Deduction]{/?} |",
      why: 'The discount row prints only when a discount is supplied, labelled "Discount" from the draft\'s own words, since the form asks for no description; it prints as the draft has it while the question is unanswered.',
    },
    {
      from: "| [Additional charge, if supplied] | [ ] |\n",
      to: "",
      why: "The form asks for each charge as an item line of its own, as its items table says, so this row goes.",
    },
    {
      from: "| [Validated user-supplied tax line, if any] | [ ] |",
      to: "| {?taxMode=supplied}[Validated user-supplied tax line, if any]{=taxLabel} | [ ]{=taxAmountKobo}{/?} |\n| {?taxMode=}[Validated user-supplied tax line, if any] | [ ]{/?} |",
      why: "The tax row prints only when a tax amount and label are supplied; it prints as the draft has it while the question is unanswered.",
    },
    {
      from: "| **Order total** | **[Calculated]** |",
      to: "| Order total | [Calculated]{=calc.total} |\n\n{?taxMode=supplied}[ ]{=taxBasis}{/?}",
      why: "The basis of a supplied tax amount prints below the amount summary, as a paragraph of its own.",
    },
    {
      from: "- Deliver to / service location or arrangement: [ ]\n- Receiving or service contact: [ ]\n- Requested or confirmed date, correctly labelled: [ ]\n- Packaging, specification or scope notes supplied by buyer: [ ]\n- Agreed or proposed payment arrangement, correctly labelled: [ ]",
      to: "- Deliver to / service location or arrangement: [ ]{=deliveryLocation}\n\n- {?receivingContact}Receiving or service contact: [ ]{=receivingContact}{/?}\n\n- Requested or confirmed date, correctly labelled: [ ]{=deliveryDate}\n\n- {?specificationNotes}Packaging, specification or scope notes supplied by buyer: [ ]{=specificationNotes}{/?}\n\n- Agreed or proposed payment arrangement, correctly labelled: [ ]{=paymentTerms}",
      why: "The receiving contact and the packaging or specification notes are optional: each line prints once it is given. Each line is a list of its own, so that no list can grow past what a document block holds.",
    },
    {
      from: "Authorised by: [Actual person/role or issuer authority]  \nAuthorisation date: [ ]  \nSupplier response: [Actual response and date, or \u201cnot recorded\u201d]  \nChange from earlier version, if any: [ ]",
      to: "Authorised by: [Actual person/role or issuer authority]{=authority}\n{?authorisationDate}Authorisation date: [ ]{=authorisationDate}{/?}\n\nSupplier response: [Actual response and date, or \u201cnot recorded\u201d]{=supplierResponse}\n\n{?changeNote}Change from earlier version, if any: [ ]{=changeNote}{/?}",
      why: "The authorisation date and any change from an earlier version are optional: each line prints once it is given. The supplier's response and the change each print as a paragraph of their own, so that no paragraph can grow past what a document block holds.",
    },
    {
      from: "Please use [Purchase order reference] in correspondence and related delivery or billing documents. Contact [Purchasing contact] to clarify any difference before proceeding on changed instructions.",
      to: "Please use [Purchase order reference]{=documentNumber} in correspondence and related delivery or billing documents.{?purchasingContact} Contact [Purchasing contact]{=purchasingContact} to clarify any difference before proceeding on changed instructions.{/?}",
      why: "The sentence that names the purchasing contact prints once a contact is given.",
    },
    {
      from: "*This document records the buyer's stated purchase instruction. Supplier acceptance, delivery and payment are separate events and are not inferred from its preparation.*",
      to: "This document records the buyer's stated purchase instruction. Supplier acceptance, delivery and payment are separate events and are not inferred from its preparation.",
    },
  ],
  "TPL-05": [
    {
      from: "**From:** [Sending business]  \n[Contact]",
      to: "From: [Sending business]{=issuerName}\n[Contact]{=issuerAddress}",
    },
    {
      from: "**To:** [Recipient/customer]  \nDestination: [ ]  \nReceiving contact, if supplied: [ ]",
      to: "To: [Recipient/customer]{=recipientName}\nDestination: [ ]{=destination}\n\n{?recipientAddress}Receiving contact, if supplied: [ ]{=recipientAddress}{/?}",
      why: "The receiving contact is optional: it prints once it is given, as a paragraph of its own so that no paragraph can grow past what a document block holds.",
    },
    {
      from: "Delivery note reference: [ ]  \nPrepared on: [ ]  \nRelated order/invoice: [If supplied]  \nMovement status: **[Actual selected status]**",
      to: "Delivery note reference: [ ]{=documentNumber}\nPrepared on: [ ]{=issueDate}\n{?relatedOrder}Related order/invoice: [If supplied]{=relatedOrder}{/?}\nMovement status: [Actual selected status]{=deliveryStatus}",
      why: "The related order or invoice is optional: its line prints once it is given.",
    },
    {
      from: "Dispatch: [Actual event date/time, or clearly labelled planned/not recorded]  \nDelivery or attempt: [Actual event date/time, or not recorded]",
      to: "{?deliveryStatus=dispatched}Dispatch: [Actual event date/time, or clearly labelled planned/not recorded]{=dispatchDate}{/?}\n{?deliveryStatus=received}Delivery or attempt: [Actual event date/time, or not recorded]{=receivedDate}{/?}\n{?deliveryStatus=}Dispatch: [Actual event date/time, or clearly labelled planned/not recorded]{/?}\n{?deliveryStatus=}Delivery or attempt: [Actual event date/time, or not recorded]{/?}",
      why: "The form asks the dispatch date of a dispatched delivery and the receipt date of a received one, so each line prints only for its status; a planned, unconfirmed or part delivery prints neither, since its status says so, and both print as the draft has them while the status is unanswered.",
    },
    {
      from: "| Item and useful reference | Unit | Quantity sent or planned, accurately labelled | Quantity physically received, if recorded |\n|---|---|---:|---:|\n| [ ] | [ ] | [ ] | [Value or “not recorded”] |\n| [ ] | [ ] | [ ] | [Value or “not recorded”] |",
      to: "| Item and useful reference | Unit | Quantity sent or planned, accurately labelled |\n|---|---|---:|\n| {*deliveryItems} [ ]{=deliveryItems.description} | [ ]{=calc.itemUnit} | [ ]{=deliveryItems.quantity} |",
      why: "One row prints for each item the form lists, so the draft's second sample row goes. The form asks one quantity for each item, printed as the quantity sent or planned, and no quantity received, so that column goes; a part delivery's shortfall prints under condition and differences.",
    },
    {
      from: "| Item reference | Accepted quantity, if recorded | Damaged/rejected quantity, if recorded | Difference or issue | Follow-up |\n|---|---:|---:|---|---|\n| [ ] | [ ] | [ ] | [ ] | [ ] |\n\nBatch/serial references, if supplied: [ ]  \nOther delivery notes: [ ]",
      to: "{?deliveryStatus=partial}Difference or issue: [ ]{=partialDetails}{/?}\n\n{?batchReferences}Batch/serial references, if supplied: [ ]{=batchReferences}{/?}\n\n{?otherNotes}Other delivery notes: [ ]{=otherNotes}{/?}",
      why: "The form asks for a part delivery's shortfall, damage and other differences in one answer, printed as its difference or issue, and asks no quantity by item, so the table goes. The batch or serial references and other notes are optional: each prints once it is given, as a paragraph of its own.",
    },
    {
      from: "Handed over by: [Actual name/role, or not recorded]  \nReceived by: [Actual name/role, or not recorded]  \nAcknowledgement and its scope: [Actual acknowledgement, or “not recorded”]  \nAcknowledgement date/time: [If recorded]",
      to: "{?handedOverBy}Handed over by: [Actual name/role, or not recorded]{=handedOverBy}{/?}\n{?acknowledger}Received by: [Actual name/role, or not recorded]{=acknowledger}{/?}\n\n{?acknowledgement}Acknowledgement and its scope: [Actual acknowledgement, or “not recorded”]{=acknowledgement}{/?}\n{?acknowledgementDate}Acknowledgement date/time: [If recorded]{=acknowledgementDate}{/?}",
      why: "Each handover line is optional: it prints once it is given, so a fact not recorded is left out rather than filled. The acknowledgement prints as a paragraph of its own, so that no paragraph can grow past what a document block holds.",
    },
    {
      from: "Outstanding action: [ ]  \nPerson responsible and user-chosen follow-up date, if agreed: [ ]",
      to: "{?outstandingAction}Outstanding action: [ ]{=outstandingAction}{/?}\n{?followUp}Person responsible and user-chosen follow-up date, if agreed: [ ]{=followUp}{/?}",
      why: "The outstanding action and its follow-up are optional: each line prints once it is given.",
    },
    {
      from: "*This note reflects the movement and handover facts entered by the issuer. A prepared or dispatched note does not establish completed delivery. Any acknowledgement is limited to what is actually recorded; payment, product fitness and regulatory approval are not established by this document.*",
      to: "This note reflects the movement and handover facts entered by the issuer. A prepared or dispatched note does not establish completed delivery. Any acknowledgement is limited to what is actually recorded; payment, product fitness and regulatory approval are not established by this document.",
    },
  ],
  "TPL-08": [
    {
      from: "**Business/team:** [ ]  \n**Meeting:** [Title and purpose]  \nMeeting reference: [ ]",
      to: "Business/team: [ ]{=issuerName}\nMeeting: [Title and purpose]{=meetingTitle}\n{?meetingReference}Meeting reference: [ ]{=meetingReference}{/?}",
      why: "The meeting reference is optional: its line prints once it is given.",
    },
    {
      from: "Date: [ ]  \nTime and timezone: [If recorded]  \nLocation or method: [ ]  \nFacilitator: [If supplied]  \nNote-taker: [If supplied]",
      to: "Date: [ ]{=issueDate}\n{?meetingTime}Time and timezone: [If recorded]{=meetingTime}{/?}\nLocation or method: [ ]{=location}\nFacilitator: [If supplied]{=chair}\nNote-taker: [If supplied]{=minuteTaker}",
      why: "The time is optional: its line prints once it is given. The chair the form asks for is the facilitator, and its minute taker the note-taker.",
    },
    {
      from: "**Present:** [Actual attendees]  \n**Apologies or invited but absent:** [Separate supplied list, if any]",
      to: "| Present |\n|---|\n| {*attendees} [Actual attendees]{=calc.attendee} |\n\n{?apologies}Apologies or invited but absent: [Separate supplied list, if any]{=apologies}{/?}",
      why: "Each attendee the form lists prints as a row of its own, with their role once it is given, so that a long list fits what a document holds. The apologies are optional: they print once given.",
    },
    {
      from: "Record status: **[Draft notes / circulated / corrected version / actual recorded confirmation]**",
      to: "Record status: [Draft notes / circulated / corrected version / actual recorded confirmation]{=recordStatus}",
    },
    {
      from: "### [Topic 1]\n\nDiscussion summary: [Concise factual summary]\n\nOutcome: [Actual decision, proposal, deferred item or unresolved question, clearly labelled]\n\n### [Topic 2, if needed]\n\nDiscussion summary: [ ]\n\nOutcome: [ ]",
      to: "{*decisions}\n### [Topic 1]{=decisions.topic}\n\nDiscussion summary: [Concise factual summary]{=decisions.discussion}\n\nOutcome: [Actual decision, proposal, deferred item or unresolved question, clearly labelled]{=decisions.outcome}\n{/*}",
      why: "One topic prints for each topic the form lists, with its discussion and outcome, so the draft's second sample topic goes.",
    },
    {
      from: "| Action reference | Agreed next action | Owner or “unassigned” | Target date or “not agreed” | Actual status |\n|---|---|---|---|---|\n| [ ] | [ ] | [ ] | [ ] | [Open / in progress / completed with recorded outcome / deferred] |\n| [ ] | [ ] | [ ] | [ ] | [ ] |",
      to: "| Agreed next action | Owner or “unassigned” | Target date or “not agreed” |\n|---|---|---|\n| {*actions} [ ]{=actions.action} | [ ]{=actions.owner} | [ ]{=calc.actionDate} |",
      why: "One row prints for each action the form lists, so the draft's second sample row goes. The form asks each action, its owner and any date, printed as not agreed when none is given, and asks no reference or status for an action, so those columns go.",
    },
    {
      from: "Unresolved questions: [ ]  \nNext review or meeting: [Proposed/agreed details, if any]  \nSupporting-record references: [ ]",
      to: "{?unresolvedQuestions}Unresolved questions: [ ]{=unresolvedQuestions}{/?}\n\n{?nextMeeting}Next review or meeting: [Proposed/agreed details, if any]{=nextMeeting}{/?}\n\n{?supportingRecords}Supporting-record references: [ ]{=supportingRecords}{/?}",
      why: "Each follow-up is optional: it prints once it is given, as a paragraph of its own so that no paragraph can grow past what a document block holds.",
    },
    {
      from: "Circulated on/to: [Only if actually circulated]  \nCorrections requested or made: [ ]  \nConfirmed by/date: [Only an actual recorded confirmation; otherwise omit or show not recorded]  \nVersion/change note: [ ]",
      to: "{?circulatedTo}Circulated on/to: [Only if actually circulated]{=circulatedTo}{/?}\n\n{?corrections}Corrections requested or made: [ ]{=corrections}{/?}\n\n{?recordStatus=confirmed}Confirmed by/date: [Only an actual recorded confirmation; otherwise omit or show not recorded]{=confirmation}{/?}{?recordStatus=}Confirmed by/date: [Only an actual recorded confirmation; otherwise omit or show not recorded]{/?}\n\n{?versionNote}Version/change note: [ ]{=versionNote}{/?}",
      why: "Each record-review line is optional and prints once it is given, as a paragraph of its own. The confirmation prints only for minutes whose status is an actual recorded confirmation, with its details; for any other status it is left out, as the draft says, and it prints as the draft has it while the status is unanswered.",
    },
    {
      from: "*These minutes record the supplied account of an ordinary business meeting. A proposal is not a decision; an action date passing is not evidence of completion. This general template does not certify statutory governance procedure, quorum, approval or a person's signature.*",
      to: "These minutes record the supplied account of an ordinary business meeting. A proposal is not a decision; an action date passing is not evidence of completion. This general template does not certify statutory governance procedure, quorum, approval or a person's signature.",
    },
  ],
  "TPL-12": [
    {
      from: "**Purpose:** Ask about an amount that the business's checked records show as outstanding. This letter is not a receipt, a legal demand or proof that a debt is undisputed or enforceable.\n\n### Information to confirm before preparing the letter\n\n- Sender business name: [ ]\n- Customer name and intended contact: [ ]\n- Letter date and date used to assess payment timing: [actual date]\n- Invoice reference and issue date: [ ]\n- Currency: [ ]\n- Original invoice amount: [ ]\n- Confirmed payments allocated to this invoice: [ ]\n- Confirmed credits or other agreed reductions: [ ]\n- Other agreed adjustment, if any, with an explanation and reference: [ ]\n- Recorded balance: [ ]\n- Balance checked on: [date and, if relevant, time/timezone]\n- Payment due date, **only if established**: [ ]; basis/reference: [ ]\n- Disputed amount or issue, if any: [ ]\n- Existing payment arrangement or customer response, if any: [ ]\n- Verified reply channel: [ ]\n- Verified payment instructions, if the sender chooses to include them: [ ]; verification basis/date: [ ]\n\nRecorded balance = invoice amount − confirmed allocated payments − confirmed credits/reductions + separately established additional adjustments. Do not infer interest, penalties or tax. Count the same transaction once. Do not combine currencies without an explicitly supplied and agreed conversion basis.\n\n### Letter",
      to: "# Letter",
      why: "The draft's purpose note, its checklist of the facts to confirm and its balance formula are directions for preparing the letter: the form asks for those facts and works out the balance by the formula, so they go, and the letter's own heading becomes the text's title.",
    },
    {
      from: "**[Sender business name]**  \n[Sender contact detail chosen for this correspondence]  \n[Letter date]",
      to: "[Sender business name]{=issuerName}\n[Sender contact detail chosen for this correspondence]{=issuerAddress}\n[Letter date]{=issueDate}",
    },
    {
      from: "To: [Customer name / agreed contact]",
      to: "To: [Customer name / agreed contact]{=recipientName}\n{?recipientAddress}[ ]{=recipientAddress}{/?}",
      why: "The customer's address is optional: it prints below their name once it is given.",
    },
    {
      from: "**Subject: Payment enquiry — invoice [invoice reference]**",
      to: "Subject: Payment enquiry — invoice [invoice reference]{=invoiceReference}",
    },
    {
      from: "Dear [Customer/contact name],",
      to: "Dear [Customer/contact name]{=recipientName},",
    },
    {
      from: "We are following up on invoice [invoice reference], dated [invoice issue date], for [brief description of the supplied goods or work].",
      to: "We are following up on invoice [invoice reference]{=invoiceReference}, dated [invoice issue date]{=invoiceIssueDate}, for [brief description of the supplied goods or work]{=billingBasis}.",
    },
    {
      from: "As of [balance-check date], our records show an original invoice amount of [currency and amount], payments of [currency and confirmed allocated payments] and confirmed credits or reductions of [currency and amount, or “none recorded”].",
      to: "As of [balance-check date]{=balanceDate}, our records show an original invoice amount of [currency and amount]{=invoiceAmountKobo}, payments of [currency and confirmed allocated payments]{=calc.payments} and confirmed credits or reductions of [currency and amount, or “none recorded”]{=creditsKobo}.",
    },
    {
      from: "[Include only when separately established: An additional agreed adjustment of [currency and signed amount] relates to [description and reference] and is included in the balance.]\n\n",
      to: "",
      why: "The form asks for no separate adjustment: the balance counts the invoice amount, the confirmed payments and the confirmed credits, so the letter states no adjustment and this paragraph goes.",
    },
    {
      from: "the remaining recorded balance is [currency and balance].",
      to: "the remaining recorded balance is [currency and balance]{=calc.balance}.",
    },
    {
      from: "[Insert one appropriate timing paragraph below.]",
      to: "{?timing=passed}The agreed payment date recorded for this invoice was [date]{=invoiceDueDate}. Please let us know the expected payment date, or raise any issue that needs resolving.{/?}{?timing=today}The payment date recorded for this invoice is today, [date]{=invoiceDueDate}. Please let us know if there is a question about the payment or our records.{/?}{?timing=ahead}The payment date recorded for this invoice is [date]{=invoiceDueDate}. This is a reminder ahead of that date.{/?}{?timing=}[Insert one appropriate timing paragraph below.]{/?}",
      why: "The form works out the timing paragraph by comparing the confirmed due date with the letter's own date, as the draft says, and prints that paragraph from those the draft gives below; it prints the draft's direction while either date is missing. The form requires a confirmed due date, so the paragraph for no established date goes.",
      moves: true,
    },
    {
      from: "[Insert the dispute or payment-arrangement paragraph below only where relevant.]",
      to: "{?disputeKind=dispute}\nWe understand that [specific issue]{=dispute} is still being discussed.{?disputedKobo} The amount currently identified as disputed is [currency and amount, if known]{=disputedKobo}.{/?}{?disputeQuestion} Please help us resolve [specific question]{=disputeQuestion}.{/?} This message does not treat that issue as settled.\n{/?}\n\n{?disputeKind=arrangement}Our recorded arrangement is [actual agreed arrangement]{=dispute}. Please let us know if our understanding is incorrect or if you need to discuss it.{/?}{?disputeKind=}[Insert the dispute or payment-arrangement paragraph below only where relevant.]{/?}",
      why: "The dispute or arrangement paragraph the draft gives below prints in its place in the letter, as the business chooses, with the amount disputed and the question to resolve once given; neither prints when there is nothing to mention, and the draft's direction prints while the choice is unanswered.",
      moves: true,
    },
    {
      from: "[Optional, only where verified: For payment, please use the following instructions: [verified instructions].]",
      to: "{?paymentInstructions}For payment, please use the following instructions: [verified instructions]{=paymentInstructions}.{/?}",
      why: "Payment instructions are optional: they print once they are given. The draft's direction around them is for the form, not wording of the letter.",
    },
    {
      from: "Please contact [reply contact/channel] if",
      to: "Please contact [reply contact/channel]{=replyContact} if",
    },
    {
      from: "[Sender name]  \n[Role, if supplied]  \n[Business name]",
      to: "[Sender name]{=senderName}\n{?senderRole}[Role, if supplied]{=senderRole}{/?}\n[Business name]{=issuerName}",
      why: "The sender's role is optional: it prints once it is given.",
    },
    {
      from: "### Choose the timing paragraph that matches the supplied facts\n\n- **Established due date has passed:** “The agreed payment date recorded for this invoice was [date]. Please let us know the expected payment date, or raise any issue that needs resolving.”\n- **Established due date is the letter date:** “The payment date recorded for this invoice is today, [date]. Please let us know if there is a question about the payment or our records.”\n- **Established due date is still ahead:** “The payment date recorded for this invoice is [date]. This is a reminder ahead of that date.”\n- **No established payment date:** “Please let us know when we can expect payment, or whether we need to clarify the payment arrangement.”\n\nDo not call an invoice overdue where the due date is missing, disputed or still ahead. A user-chosen follow-up date is not a statutory deadline.\n\n### Optional paragraph for a dispute or arrangement\n\n- **Dispute:** “We understand that [specific issue] is still being discussed. The amount currently identified as disputed is [currency and amount, if known]. Please help us resolve [specific question]. This message does not treat that issue as settled.”\n- **Existing arrangement:** “Our recorded arrangement is [actual agreed arrangement]. Please let us know if our understanding is incorrect or if you need to discuss it.”\n\n### Guided input and validation requirements\n\nRequired to produce a usable completed letter: sender, customer, actual letter date, invoice reference, currency, invoice amount, checked payment/credit facts, balance-check date and reply channel. Compare the established due date with the actual letter date, not a guessed or hidden date. Any additional adjustment must appear with its signed amount, explanation and reference in both the reconciliation and the letter; no hidden adjustment is permitted. A missing amount must not become zero. A customer assertion that payment was sent must remain distinct from reconciled payment records.\n\nThe editor must calculate the balance deterministically, flag duplicate payment references and resolve conflicting figures before acceptance. If the balance is zero, offer an account-status clarification instead of a demand for payment. If negative, flag a possible excess payment for reconciliation; do not initiate or promise a refund. The user must review the draft before accepting it. The AI workflow has no email, collection, payment or legal-filing action.",
      to: "",
      why: "The timing and dispute paragraphs print in their places in the letter above, chosen from the answers; the rest is direction for the form and its checks, not wording of the letter.",
    },
  ],
  "TPL-15": [
    {
      from: "### Parties, purpose and periods\n\nThis mutual agreement is between **[Party A legal name, entity type and address]** and **[Party B legal name, entity type and address]**. Agreement reference [ ]; date [ ].",
      to: "# Non-disclosure agreement\n\n### Parties, purpose and periods\n\nThis mutual agreement is between [Party A legal name, entity type and address]{=partyA}\n\nand [Party B legal name, entity type and address]{=partyB}. Agreement reference [ ]{=documentNumber}; date [ ]{=issueDate}.",
      why: "The draft has no title line, so the form text takes the template's registered title, which the staff library shows and no document prints. The two parties print as paragraphs of their own, since both addresses together can be longer than a document block holds.",
    },
    {
      from: "Permitted purpose: **[describe the proposed discussion, project or evaluation narrowly]**. Disclosure period: [start] to [end]. Protection period for each disclosure: [agreed duration and start event]. Named contacts and permitted recipient categories: [ ]. Nigerian State/FCT and relevant governing-law choice: [ ]. Courts of competent jurisdiction/location: [ ].",
      to: "Permitted purpose: [describe the proposed discussion, project or evaluation narrowly]{=purpose}.\n\nDisclosure period: [start]{=disclosureStart} to [end]{=disclosureEnd}. Protection period for each disclosure: [agreed duration and start event]{=duration}.\n\nNamed contacts and permitted recipient categories: [ ]{=permittedRecipients}.\n\nNigerian State/FCT and relevant governing-law choice: [ ]{=jurisdiction}. Courts of competent jurisdiction/location: [ ]{=jurisdiction}.",
      why: "The entries print as paragraphs of their own, since together they can be longer than a document block holds. v1 asks the State/FCT and the Nigerian-law scope in one answer, which names the courts' location too.",
    },
    {
      from: "Examples relevant to this exchange: [ ].",
      to: "Examples relevant to this exchange: [ ]{=protectedInfo}.",
    },
    {
      from: " Approved tools and storage locations, if any: [ ].",
      to: "{?approvedTools} Approved tools and storage locations, if any: [ ]{=approvedTools}.{/?}",
      why: "Approved tools and storage locations are optional: the sentence prints once they are given, and without them no tool or location is approved.",
    },
    {
      from: "return or securely delete copies within [agreed period], confirming",
      to: "return or securely delete copies within [agreed period]{=returnTerms}, confirming",
    },
    {
      from: "escalate to [decision-makers] after [agreed period], without",
      to: "escalate to [decision-makers]{=disputeTerms}, without",
      why: "v1 asks the escalation arrangements in one answer, which names the decision-makers and the period, so the period's placeholder goes.",
    },
    {
      from: "Notice addresses/email: Party A [ ]; Party B [ ]. Notices",
      to: "Notice addresses/email: Party A [ ]{=issuerAddress};\n\nParty B [ ]{=recipientAddress}. Notices",
      why: "Each party's address prints as its notice address, in a paragraph of its own, since both together can be longer than a document block holds.",
    },
    {
      from: "| [ ] | [ ] | [ ] | [ ] |\n| [ ] | [ ] | [ ] | [ ] |",
      to: "| [ ]{=registerReference} | [ ]{=registerInformation} | [ ]{=registerParties} | [ ]{=registerEnd} |\n| [ ]{=registerReference} | [ ]{=registerInformation} | [ ]{=registerParties} | [ ]{=registerEnd} |",
    },
    {
      from: "Party A legal name [ ]; signatory/name/capacity [ ]; authority reference [ ]; signature/date [ ]. Party B legal name [ ]; signatory/name/capacity [ ]; authority reference [ ]; signature/date [ ].",
      to: "Party A legal name [ ]{=issuerName}; signatory/name/capacity [ ]{=signatoryA}; authority reference [ ]{=authorityA}; signature/date [ ]{=signatureA}. Party B legal name [ ]{=recipientName}; signatory/name/capacity [ ]{=signatoryB}; authority reference [ ]{=authorityB}; signature/date [ ]{=signatureB}.",
    },
  ],
  "TPL-16": [
    {
      from: "Contract reference: [ ] · Version: [ ] · Date: [ ]",
      to: "Contract reference: [ ]{=documentNumber}{?contractVersion} · Version: [ ]{=contractVersion}{/?} · Date: [ ]{=issueDate}",
      why: "The version is optional: it prints once it is given.",
    },
    {
      from: "This agreement is between **[Employer legal name]**, of [Employer address], and **[Employee name]**, of [Employee address]. The employer appoints",
      to: "This agreement is between [Employer legal name]{=issuerName}, of [Employer address]{=issuerAddress},\n\nand [Employee name]{=recipientName}, of [Employee address]{=recipientAddress}. The employer appoints",
      why: "The two parties print as paragraphs of their own, since both addresses together can be longer than a document block holds.",
    },
    {
      from: "The employee is appointed as **[Role]**, reporting to [Role/person]. The principal duties are [specific duties or attached role-description reference/version].",
      to: "The employee is appointed as [Role]{=role}, reporting to [Role/person]{=reportsTo}. The principal duties are [specific duties or attached role-description reference/version]{=duties}.",
    },
    {
      from: "The normal work location is [Location/remote arrangement]. Any agreed travel or additional-location arrangement is [specific arrangement or none]. Required qualifications or permissions for the role are [verified requirements and status]; no missing qualification is represented as held.",
      to: "The normal work location is [Location/remote arrangement]{=workplace}.\n\n{?qualifications}Required qualifications or permissions for the role are [verified requirements and status]{=qualifications}; no missing qualification is represented as held.{/?}",
      why: "v1 asks for the work location with its remote and travel arrangements in one answer, printed as the normal work location, so the sentence for travel goes. The required qualifications are optional: their sentence prints, as a paragraph of its own, once they are given.",
    },
    {
      from: "Employment starts on [Date]. Recognised earlier continuous service, if any, is [date/basis or none confirmed]. The engagement is [indefinite / fixed term ending on specified date and basis].",
      to: "Employment starts on [Date]{=startDate}. Recognised earlier continuous service, if any, is [date/basis or none confirmed]{=earlierService}. The engagement is {?termType=open}indefinite{/?}{?termType=fixed}fixed term ending on [ ]{=endDate}{/?}{?termType=}[indefinite / fixed term ending on specified date and basis]{/?}.",
      why: "The duration prints as the choice made, with a fixed term's end date; v1 asks no basis for a fixed term. It prints as the draft has it while the question is unanswered.",
    },
    {
      from: "[Include only a separately validated, expressly agreed probation clause: The agreed initial review period is [period], with reviews on [basis/dates]. Support and assessment criteria are [ ]. The applicable pay, benefits and notice arrangements during this period are [validated terms]. Any proposed extension will be discussed and documented before implementation; no extension or termination is assumed merely because a review was not recorded.]",
      to: "{?probation=yes}\nThe agreed initial review period is [period]{=probationTerms}. Any proposed extension will be discussed and documented before implementation; no extension or termination is assumed merely because a review was not recorded.\n{/?}\n\n{?probation=}\n[Include only a separately validated, expressly agreed probation clause: The agreed initial review period is [period], with reviews on [basis/dates]. Support and assessment criteria are [ ]. The applicable pay, benefits and notice arrangements during this period are [validated terms]. Any proposed extension will be discussed and documented before implementation; no extension or termination is assumed merely because a review was not recorded.]\n{/?}",
      why: "The review period's clause prints only when one is expressly agreed, without the draft's direction around it, and the draft's paragraph prints while the question is unanswered. v1 asks the period's terms and dates in one answer, printed as the agreed initial review period, so the sentences for its reviews, its criteria and the pay, benefits and notice during it, each a placeholder of its own, go; that answer has to state them.",
    },
    {
      from: "Gross basic pay is [Currency and amount] per [period], calculated as [fixed salary/hourly or other validated basis]. Separately identified allowances or variable pay are listed in Schedule A, with their calculation and eligibility rules. Payment is due [validated cycle/date arrangement] through [agreed lawful method]. The employer will provide a clear record of the amounts paid and any deductions.",
      to: "Gross basic pay is [Currency and amount]{=grossPayKobo} per [period]{=payPeriod}, calculated as [fixed salary/hourly or other validated basis]{=payBasis}.\n\nSeparately identified allowances or variable pay are [ ]{=allowances}. The employer will provide a clear record of the amounts paid and any deductions.",
      why: "v1 asks how the pay is calculated, its cycle and its method in one answer, printed as how it is calculated, so the sentence for the cycle and the method goes. The allowances print here, as a paragraph of their own, instead of in Schedule A, since the schedule's other pay terms print in this clause; the question asks for their calculation and eligibility rules.",
    },
    {
      from: "The employee may raise a payroll query with [contact].",
      to: "The employee may raise a payroll query with [contact]{=workContact}.",
    },
    {
      from: "Normal working days and hours are [ ]. Rest intervals and weekly rest arrangements are [validated terms]. Overtime, additional work and any related payment or time-off arrangement are [validated terms and authorisation process]. Recording",
      to: "Normal working days and hours are [ ]{=hours}. Recording",
      why: "v1 asks the working hours, breaks and overtime in one answer, printed as the normal working days and hours, so the two sentences for rest and for overtime, each a placeholder of its own, go.",
    },
    {
      from: "The employee should notify [contact] promptly when unable to attend, using [channel].",
      to: "The employee should notify [contact]{=workContact} promptly when unable to attend.",
      why: "The contact's answer says how to reach them, so the separate channel goes.",
    },
    {
      from: "Pension and other applicable benefit arrangements are [validated scheme/coverage, contribution basis and accessible explanation].",
      to: "Pension and other applicable benefit arrangements are [validated scheme/coverage, contribution basis and accessible explanation]{=benefits}.",
    },
    {
      from: "Questions about leave or benefits may be raised with [contact],",
      to: "Questions about leave or benefits may be raised with [contact]{=workContact},",
    },
    {
      from: "promptly report loss or suspected misuse through [contact/channel].",
      to: "promptly report loss or suspected misuse through [contact/channel]{=workContact}.",
    },
    {
      from: "must be identified in [separately reviewed document, if any];",
      to: "must be identified in [separately reviewed document, if any]{=confidentialityTerms};",
    },
    {
      from: "The applicable grievance and disciplinary processes are [document titles/versions and accessible location].",
      to: "The applicable grievance and disciplinary processes are [document titles/versions and accessible location]{=grievanceTerms}.",
    },
    {
      from: "| Item | Agreed and validated term |\n|---|---|\n| Engagement place/date; start; recognised service | [ ] |\n| Role, work location and duration | [ ] |\n| Gross pay; allowances; calculation; payment cycle | [ ] |\n| Normal hours; rest; overtime arrangement | [ ] |\n| Annual leave quantity, unit, qualifying basis and pay | [ ] |\n| Sick leave/pay and appropriate evidence process | [ ] |\n| Maternity-related leave/pay, nursing arrangements and applicable protection | [ ] |\n| Other leave and contractual improvements | [ ] |\n| Pension/other benefits and applicable contribution basis | [ ] |\n| Employer notice; employee notice; payment-in-lieu basis | [ ] |\n| Special conditions individually agreed and separately checked | [ ] |",
      to: "- Engagement place/date: [ ]{=engagement}\n\n- Annual leave quantity, unit, qualifying basis and pay; Sick leave/pay and appropriate evidence process; Maternity-related leave/pay, nursing arrangements and applicable protection; Other leave and contractual improvements: [ ]{=leaveTerms}\n\n- Employer notice; employee notice; payment-in-lieu basis: [ ]{=terminationTerms}\n\n- {?specialConditions}Special conditions individually agreed and separately checked: [ ]{=specialConditions}{/?}",
      why: "The confirmed terms print one to a line, each a list of its own, since each answer can be longer than a table cell holds, so the table's headings go. The rows whose terms print in their clauses go, so that each answer prints once: the start and recognised service, the role, location and duration, the pay and allowances, the hours, and the pension and benefits. The engagement row keeps its place and date. v1 asks every kind of leave in one answer, printed against the four leave rows together. The special conditions are optional: their line prints once they are given.",
    },
    {
      from: "| Document | Version/date | Where the employee can obtain it | Relationship to this agreement |\n|---|---|---|---|\n| Role description | [ ] | [ ] | [ ] |\n| Employee handbook | [ ] | [ ] | [ ] |\n| Leave policy | [ ] | [ ] | [ ] |\n| Disciplinary/grievance procedure | [ ] | [ ] | [ ] |\n| Relevant collective/sector terms, if applicable | [ ] | [ ] | [ ] |",
      to: "[ ]{=policies}",
      why: "v1 asks the policies and schedules incorporated, with their versions, in one answer, which prints as the schedule; the table, whose cells cannot hold an answer that long, goes.",
    },
    {
      from: "Employer representative name and authority: [ ]  \nEmployee name: [ ]  \nActual agreement/signature record and dates, only when completed by the parties: [ ]  \nCopy provided to employee on: [actual date]",
      to: "Employer representative name and authority: [ ]{=representativeAuthority}\nEmployee name: [ ]{=recipientName}\nActual agreement/signature record and dates, only when completed by the parties: [ ]{=signatureRecord}\nCopy provided to employee on: [actual date]{=copyProvided}",
    },
  ],
  "TPL-17": [
    {
      from: "[Employer legal name and address]  \n[Date] · Reference [ ]\n\nDear [Candidate name],",
      to: "[Employer legal name and address]{=employer}\n[Date]{=issueDate} · Reference [ ]{=documentNumber}\n\n[ ]{=candidate}\n\nDear [Candidate name]{=recipientName},",
      why: "The candidate's name and address print above the greeting, where a letter names its reader; the draft has no placeholder for them there, so this one prints as [ ] until they are given.",
    },
    {
      from: "We are pleased to offer you the position of **[Role]** with [Employer], reporting to [Role/person]. The proposed start date is [Date] and the normal work location or remote arrangement is [ ]. The principal duties are set out in [attached role description and version].",
      to: "We are pleased to offer you the position of [Role]{=role} with [Employer]{=issuerName}, reporting to [Role/person]{=reportsTo}. The proposed start date is [Date]{=startDate} and the normal work location or remote arrangement is [ ]{=workplace}.\n\nThe principal duties are set out in [attached role description and version]{=duties}.",
      why: "The duties print as a paragraph of their own, so that no paragraph can grow past what a document block holds.",
    },
    {
      from: "| Item | Offer detail |\n|---|---|\n| Employment duration | [Indefinite / fixed term with stated end and basis] |\n| Gross basic pay and currency | [Amount per period and calculation basis] |\n| Payment cycle and method | [ ] |\n| Additional allowances or variable pay | [Specific terms or none offered] |\n| Working days, hours, breaks and additional-work arrangements | [ ] |\n| Annual leave and other leave/pay terms | [Complete validated terms or exact attached schedule] |\n| Pension and other applicable benefits | [Complete validated arrangements or exact attached schedule] |\n| Notice and any initial review period | [Validated terms; no default probation] |",
      to: "- Employment duration: {?termType=open}Indefinite{/?}{?termType=fixed}fixed term with stated end [ ]{=endDate}{/?}{?termType=}[Indefinite / fixed term with stated end and basis]{/?}\n\n- Gross basic pay and currency: [Amount]{=grossPayKobo} per [period]{=payPeriod}\n\n- Payment cycle and method: [ ]{=payBasis}\n\n- Additional allowances or variable pay: [Specific terms or none offered]{=allowances}\n\n- Working days, hours, breaks and additional-work arrangements: [ ]{=hours}\n\n- Annual leave and other leave/pay terms: [Complete validated terms or exact attached schedule]{=leaveTerms}\n\n- Pension and other applicable benefits: [Complete validated arrangements or exact attached schedule]{=benefits}\n\n- Notice and any initial review period: [Validated terms]{=terminationTerms}{?probation=no}; no default probation{/?}{?probation=}; no default probation{/?}\n\n{?probation=yes}\n- [ ]{=probationTerms}\n{/?}",
      why: 'The proposed terms print one to a line, each a list of its own, since each answer can be longer than a table cell holds, so the table\'s headings go. The duration prints as the choice made, with a fixed term\'s end date; v1 asks no basis for a fixed term. The gross pay prints in naira for its period; v1 asks how it is calculated, its cycle and its method in one answer, printed under "Payment cycle and method". The notice terms print with "no default probation" while no review period is agreed or the question is unanswered; an agreed one prints on its own line below them.',
    },
    {
      from: "This offer is accompanied by [employment contract reference/version and schedules].",
      to: "This offer is accompanied by [employment contract reference/version and schedules]{=contractReference}.",
    },
    {
      from: "The specific conditions still to be completed are [condition, responsible party, appropriate evidence and agreed timetable], or [no outstanding conditions]. We will communicate the outcome of each condition accurately.",
      to: "{?conditions=listed}The specific conditions still to be completed are [condition, responsible party, appropriate evidence and agreed timetable]{=conditionDetails}. We will communicate the outcome of each condition accurately.{/?}{?conditions=none}The specific conditions still to be completed: no outstanding conditions.{/?}{?conditions=}The specific conditions still to be completed are [condition, responsible party, appropriate evidence and agreed timetable], or [no outstanding conditions]. We will communicate the outcome of each condition accurately.{/?}",
      why: "The conditions print as the choice made: the conditions listed, with the promise to report each outcome, or that there are no outstanding conditions. The sentence prints as the draft has it while the question is unanswered.",
    },
    {
      from: "Please contact [name/channel] to ask questions or provide your response by [employer-selected response date, if supplied].",
      to: "Please contact [name/channel]{=representative} to ask questions or provide your response{?responseDate} by [employer-selected response date, if supplied]{=responseDate}{/?}.",
      why: "The response date is optional: it prints once it is given.",
    },
    {
      from: "use [actual agreed response method].",
      to: "use [actual agreed response method]{=responseMethod}.",
    },
    {
      from: "Your proposed first-day contact is [ ], and the practical joining arrangements are [ ].",
      to: "Your proposed first-day contact is [ ]{=firstDayContact}, and the practical joining arrangements are [ ]{=joiningArrangements}.",
    },
    {
      from: "[Authorised employer representative]  \n[Role]  \n[Contact]",
      to: "[Authorised employer representative]{=representative}",
      why: "v1 asks for the authorised representative and how to reach them in one answer, which signs the letter here, so the lines for their role and contact go.",
    },
    {
      from: "Candidate response: [accepted stated version / questions / changes requested / declined / no response recorded]  \nDate and response reference: [ ]  \nOutstanding matter: [ ]  \nFinal start arrangements confirmed on: [actual date, if confirmed]",
      to: "Candidate response: [accepted stated version / questions / changes requested / declined / no response recorded]{=responseStatus}\nDate and response reference: [ ]{=responseReference}\nOutstanding matter: [ ]{=outstandingMatter}\nFinal start arrangements confirmed on: [actual date, if confirmed]{=startConfirmed}",
    },
  ],
};

/** Applies a map's changes to a draft, each to text that occurs exactly once. */
export function annotateDraft(draft: string, changes: readonly FormTextChange[]) {
  return changes.reduce((text, change) => {
    const at = text.indexOf(change.from);
    if (!change.from || at < 0 || text.indexOf(change.from, at + 1) >= 0)
      throw Error("FORM_TEXT_MAP_DOES_NOT_MATCH_THE_DRAFT");
    return text.slice(0, at) + change.to + text.slice(at + change.from.length);
  }, draft);
}

/** The form text proposed for a template, from its hash-checked retained draft, or null when no map
 * is written for it yet. */
export async function proposedFormText(templateId: string) {
  const changes = FORM_TEXT_MAPS[templateId as GuidedTemplateId];
  if (!changes) return null;
  const { section } = await readTemplateIntake(templateId);
  return annotateDraft(section.body, changes).trim();
}
