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
export type FormTextChange = { from: string; to: string; why?: string };

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
