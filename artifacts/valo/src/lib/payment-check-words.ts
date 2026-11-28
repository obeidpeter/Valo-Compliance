import { formatDay } from "./format";

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

/**
 * The words finance reads for a Paystack event Valo could not match or process
 * (docs/architecture/reconciliation.md, slice 3a): why the event worker left it for finance, and what the
 * event was.
 */
const EVENT_FINDING_WORDS: Record<string, string> = {
  UNMATCHED_REFERENCE:
    "It names a reference that is no order or refund of Valo's, or no reference at all. Look for the payment at Paystack.",
  RECORD_DIFFERENCE:
    "What Paystack says about it does not match Valo's record of the order, refund or dispute it names.",
  NO_ANSWER: "Valo could not check it with Paystack: no answer that could be used came, five times.",
  SERVER_VERIFICATION_REQUIRED: "Valo could not process it. It came before Valo named why.",
  PRIVACY_ERASURE_FINANCE_REVIEW:
    "The workspace it was about has been erased. Look at what Paystack holds for it.",
  LISTING_UNREAD:
    "Valo could not read Paystack's list of this day's successful payments, three times, an hour apart. Read the list at Paystack.",
  LISTING_INCOMPLETE:
    "Paystack's list of this day's successful payments was longer than the twenty pages Valo reads. Read the rest at Paystack.",
};
const UNNAMED_EVENT =
  "Valo could not process it, for a reason it does not name yet. Look for it at Paystack.";

/** Why the event worker left an event for finance, in plain words. */
export function eventFindingWords(finding: string): string {
  return EVENT_FINDING_WORDS[finding] ?? UNNAMED_EVENT;
}

/** What kind of event Paystack sent, in plain words. */
export function eventTypeWords(eventType: string): string {
  if (eventType === "charge.success") return "A successful payment";
  if (eventType.startsWith("charge.dispute.")) return "A dispute";
  if (eventType.startsWith("refund.")) return "A refund";
  if (eventType === "listing") return "Paystack's list of a day's successful payments";
  return `An event Paystack calls ${eventType}`;
}

/** How finance's list names an event: by the reference it names, or, for what Paystack's own list of a day
 * could not give, by the day (docs/architecture/reconciliation.md, slice 3b). */
export function eventHeading(eventType: string, reference: string | null): string {
  if (eventType === "listing" && reference) return `Paystack's list for ${formatDay(reference)}`;
  return reference ?? "No reference";
}

/** When the event reached Valo, or, for a day's list, when Valo recorded what the list could not give. */
export function eventTimeWords(eventType: string): string {
  return eventType === "listing" ? "Recorded" : "Received";
}
