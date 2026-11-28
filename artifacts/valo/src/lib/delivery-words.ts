import type { MessageDelivery } from "@workspace/api-client-react";

/**
 * What the email service reported about a message or reminder it took, in the customer's words
 * (docs/architecture/messages.md, part 3).
 *
 * "Delivered" is the email service's own report, and says so. Valo does not know that anyone opened the
 * message, or which folder it went to, and the words say that too. Nothing is called delivered because
 * Valo handed it over: only because the email service reported it.
 */
export const DELIVERY: Record<MessageDelivery, { label: string; means: string; tone: string }> = {
  delivered: {
    label: "Delivered",
    means:
      "The email service reports that this message was delivered. Valo cannot see whether it was opened, or which folder it went to.",
    tone: "pill-forest",
  },
  delayed: {
    label: "Delayed",
    means: "The email service has not been able to deliver this message yet, and is still trying.",
    tone: "pill-ochre",
  },
  bounced: {
    label: "Not delivered",
    means:
      "The email service reports that this message came back: the address did not take it. The email address may be wrong or no longer in use.",
    tone: "pill-ochre",
  },
  complained: {
    label: "Marked as spam",
    means: "The email service reports that this message was marked as spam.",
    tone: "pill-ochre",
  },
  undelivered: {
    label: "Not delivered",
    means: "The email service could not send this message.",
    tone: "pill-ochre",
  },
};

type Reported = { delivery?: MessageDelivery | null | undefined };

/** The report's words, or nothing when the email service has reported nothing. */
export function deliveryWords({ delivery }: Reported) {
  return delivery ? (DELIVERY[delivery] ?? null) : null;
}

/** The one report the customer cannot clear alone: the email service itself could not send. */
export function deliveryNeedsHelp({ delivery }: Reported) {
  return delivery === "undelivered";
}
