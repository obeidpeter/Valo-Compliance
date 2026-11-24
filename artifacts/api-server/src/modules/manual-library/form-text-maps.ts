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
