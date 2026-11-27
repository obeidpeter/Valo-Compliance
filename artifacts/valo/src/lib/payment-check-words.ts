/**
 * The words finance reads for a daily payment check (docs/architecture/reconciliation.md, slices 1 and 2):
 * what each finding means, and what each outcome of a settlement records.
 */
const FINDING_WORDS: Record<string, string> = {
  AMOUNT_DIFFERENCE: "Paystack's amount or currency for this order is not the order's.",
  TRANSACTION_DIFFERENCE:
    "Paystack's transaction is not this order's: it names another order or workspace, or it is not the transaction Valo holds for the order.",
  REVERSAL_DIFFERENCE: "Valo holds this payment as reversed, and Paystack does not.",
  ENTITLEMENT_DIFFERENCE:
    "The order is paid, and a template it bought is not available to the workspace, with no refund in full or dispute on record to explain it.",
  RECEIPT_OUTBOX_MISSING: "The order is paid, and no receipt is recorded for it.",
  EVENT_MISSING:
    "The order has been paid for more than an hour, and Paystack's event for the payment has not arrived.",
  NO_ANSWER: "Paystack gave no answer that could be used, three times, an hour apart.",
  VERIFICATION_OR_FULFILMENT_DIFFERENCE:
    "This check was made before Valo named what differs. Look at the order at Paystack.",
  PRIVACY_ERASURE_FINANCE_REVIEW:
    "The workspace's data was erased, and what the check found is no longer kept. Look at the order at Paystack.",
};
const UNNAMED = "Something Valo does not name yet differs. Look at the order at Paystack.";

/** What a check found, a sentence for each name its finding gives. */
export function findingWords(finding: string): string[] {
  const names = finding.split(";").filter(Boolean);
  return [...new Set(names.map((name) => FINDING_WORDS[name] ?? UNNAMED))];
}

/** What finance can record about a difference, and what each records. */
export const OUTCOME_WORDS = {
  explained: {
    label: "Explained",
    text: "The difference is understood, and nothing in Valo needs changing.",
  },
  no_payment_stands: {
    label: "No payment stands",
    text: "No payment stands for this order: it was never paid, or it was refunded at Paystack. Valo stops asking Paystack about it before another order for its template.",
  },
} as const;
export type PaymentCheckOutcome = keyof typeof OUTCOME_WORDS;
