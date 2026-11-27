/**
 * The words of each message, composed from the record it is about when the message is sent
 * (docs/architecture/messages.md, parts 1 and 5). Nothing here reads the database: the dispatcher hands
 * over the record as it is at that moment. The words are proposals for the owner to review before the
 * first real send (the design's owner's point 3).
 *
 * Each necessary message says why it is sent and carries no unsubscribe link. None names a customer, and
 * none says a message was delivered: a sender's acceptance is not delivery.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lagosClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * An instant as the site writes it, on a Lagos clock with the month as a word: "18 Nov 2026, 09:00". The
 * text is built from numbers, as `artifacts/valo/src/lib/format.ts` builds it, so a message reads the
 * same as the screens.
 */
export function lagosTime(instant: Date) {
  const part = Object.fromEntries(lagosClock.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${Number(part.day)} ${MONTHS[Number(part.month) - 1]} ${part.year}, ${part.hour}:${part.minute}`;
}

/** An amount in kobo as naira: "₦1,500.00". */
export function naira(kobo: number) {
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw Error("MESSAGE_AMOUNT_INVALID");
  const whole = Math.floor(kobo / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${whole}.${String(kobo % 100).padStart(2, "0")}`;
}

export type ComposedMessage = { subject: string; text: string };

/** Where a message links to: the site's own address, or none when it has no configured address. */
const link = (origin: string | null, path: string, words: string) =>
  origin ? `${words}: ${origin}${path}` : `${words}: open Valo and choose Purchases.`;

const necessaryFooter = (why: string) =>
  `You receive this message because ${why}. It is a necessary message about your account, so it has no unsubscribe link.`;

/** A settled order's receipt message (PAY-009). The receipt itself is on the purchases screen. */
export function receiptMessage(
  order: {
    reference: string;
    title: string;
    amountKobo: number;
    recordedAt: Date;
    testMode: boolean;
  },
  origin: string | null,
): ComposedMessage {
  return {
    subject: `Your Valo receipt for order ${order.reference}`,
    text: [
      "Valo has recorded your purchase.",
      "",
      `Order: ${order.reference}`,
      `Bought: ${order.title}`,
      `Amount: ${naira(order.amountKobo)}`,
      `Recorded: ${lagosTime(order.recordedAt)} (Lagos time)`,
      "",
      link(origin, "/workspace/purchases", "Your receipt is on your purchases page"),
      "",
      "This is Valo's receipt for your purchase. It is not a business invoice, a government receipt or an official tax invoice.",
      ...(order.testMode
        ? ["This purchase was made in the payment provider's test mode: no real money was taken."]
        : []),
      "",
      necessaryFooter("you made this purchase"),
    ].join("\n"),
  };
}

/** A refund the payment provider confirmed (PAY-008). A refund only asked for owes no message. */
export function refundMessage(
  refund: {
    orderReference: string;
    refundReference: string;
    amountKobo: number | null;
    processedAt: Date;
    testMode: boolean;
  },
  origin: string | null,
): ComposedMessage {
  return {
    subject: `Your Valo refund on order ${refund.orderReference} was processed`,
    text: [
      "The payment provider has confirmed a refund on your order.",
      "",
      `Order: ${refund.orderReference}`,
      `Refund: ${refund.refundReference}`,
      `Amount: ${refund.amountKobo === null ? "not confirmed by the provider" : naira(refund.amountKobo)}`,
      `Processed: ${lagosTime(refund.processedAt)} (Lagos time)`,
      "",
      "A processed refund is not yet confirmation that your bank has credited your account.",
      link(origin, "/workspace/purchases", "The refund is on your purchases page"),
      ...(refund.testMode
        ? ["", "This refund was made in the payment provider's test mode: no real money moved."]
        : []),
      "",
      necessaryFooter("a refund was processed on your purchase"),
    ].join("\n"),
  };
}
