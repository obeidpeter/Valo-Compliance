/**
 * The messages' fixed rules (docs/architecture/messages.md, part 1): each kind and its class, and how often a
 * message is offered to a sender. Nothing here reads the database.
 */

/** Each kind of message there is, and its class. */
export const MESSAGE_KINDS = {
  /** A settled order's receipt (PAY-009). Its subject is the order. */
  purchase_receipt: "necessary",
  /** A refund the payment provider confirmed (PAY-008). Its subject is the refund. */
  refund_processed: "necessary",
  /**
   * One day's notices to a workspace of changes that affect it (EDP-011, part 7). Its subject is the day's
   * row in `valo_notice_digests`.
   */
  notices_digest: "necessary",
} as const;
export type MessageKind = keyof typeof MESSAGE_KINDS;

/** How many times a message is offered to a sender before it fails. The table holds it to this. */
export const MESSAGE_ATTEMPT_LIMIT = 5;

/** When a message whose attempt was not taken is offered again, or null once its attempts are spent. */
export function messageRetryAt(attempt: number, now: Date) {
  if (!Number.isInteger(attempt) || attempt < 1) throw Error("INVALID_MESSAGE_ATTEMPT");
  return attempt >= MESSAGE_ATTEMPT_LIMIT ? null : new Date(+now + Math.min(60, 2 ** (attempt - 1)) * 60_000);
}

/**
 * A day's notices are emailed the morning after, from this hour on a Lagos clock: the day has ended, so
 * its notices are all there, and the message does not arrive in the night.
 */
export const NOTICES_MESSAGE_HOUR = 7;
const lagosCalendar = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/**
 * The Lagos day whose notices are not yet owed their message at `now`, as YYYY-MM-DD: every day before it
 * has ended and reached its morning. Until the hour above, that is still the day before.
 */
export function noticesOpenDay(now: Date) {
  const part = Object.fromEntries(
    lagosCalendar
      .formatToParts(new Date(+now - NOTICES_MESSAGE_HOUR * 60 * 60_000))
      .map((p) => [p.type, p.value]),
  );
  return `${part.year}-${part.month}-${part.day}`;
}
/**
 * How many days back a day's notices still owe their message. A worker that was stopped for a few days
 * catches up; notices older than this stay where they have been since they were made, in the app.
 */
export const NOTICES_MESSAGE_DAYS_BACK = 7;
/** How many of a day's notices of one sort a message names before it counts the rest. */
export const NOTICES_NAMED = 10;
