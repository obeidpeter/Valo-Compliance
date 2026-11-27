/**
 * The messages' fixed rules (docs/architecture/messages.md, part 1): each kind and its class, and how often a
 * message is offered to a sender. Nothing here reads the database.
 */

/** Each kind of message slice 1 sends, and its class. */
export const MESSAGE_KINDS = {
  /** A settled order's receipt (PAY-009). Its subject is the order. */
  purchase_receipt: "necessary",
  /** A refund the payment provider confirmed (PAY-008). Its subject is the refund. */
  refund_processed: "necessary",
} as const;
export type MessageKind = keyof typeof MESSAGE_KINDS;

/** How many times a message is offered to a sender before it fails. The table holds it to this. */
export const MESSAGE_ATTEMPT_LIMIT = 5;

/** When a message whose attempt was not taken is offered again, or null once its attempts are spent. */
export function messageRetryAt(attempt: number, now: Date) {
  if (!Number.isInteger(attempt) || attempt < 1) throw Error("INVALID_MESSAGE_ATTEMPT");
  return attempt >= MESSAGE_ATTEMPT_LIMIT ? null : new Date(+now + Math.min(60, 2 ** (attempt - 1)) * 60_000);
}
