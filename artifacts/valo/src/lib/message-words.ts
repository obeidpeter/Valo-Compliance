import type {
  MessageDelivery,
  WorkspaceMessage,
  WorkspaceMessageKind,
  WorkspaceMessageStatus,
} from "@workspace/api-client-react";
import { deliveryNeedsHelp, deliveryWords } from "./delivery-words";

/** What each kind of message is called. */
export const MESSAGE_KIND: Record<WorkspaceMessageKind, string> = {
  purchase_receipt: "Receipt",
  refund_processed: "Refund notice",
};

/**
 * What a message's state is called, and what it means when no reason says more.
 *
 * "Accepted by email service" is not "delivered": Valo knows the email service took the message, and
 * does not know that it reached an inbox. "Not emailed" is a message Valo only recorded while it was
 * not sending emails: nothing left Valo, so it is never called accepted. No state is called delivered:
 * that word is the email service's own report (delivery-words.ts), shown only when it made one.
 */
export const MESSAGE_STATUS: Record<WorkspaceMessageStatus, { label: string; means: string }> = {
  queued: { label: "Waiting", means: "Not sent yet." },
  sending: { label: "Sending now", means: "Valo is sending this now. It has not been confirmed yet." },
  held: { label: "On hold", means: "Not sent. This message is on hold." },
  accepted: {
    label: "Accepted by email service",
    means: "The email service accepted this message. That does not show it reached your inbox.",
  },
  recorded: {
    label: "Not emailed",
    means: "Nothing was emailed: Valo was not sending emails when this message was due.",
  },
  failed: {
    label: "Not confirmed",
    means: "The email service did not confirm that it accepted this message. Valo has stopped trying.",
  },
  cancelled: { label: "Cancelled", means: "It will not be sent." },
};

/** Why a message is in its state, by the reason the server records. */
const REASONS: Record<string, string> = {
  SENDER_NOT_CONFIGURED: "Valo is not sending emails yet. Nothing has been emailed.",
  MESSAGES_PAUSED: "Valo has paused its messages for now. This one waits until they start again.",
  SENDER_DID_NOT_TAKE:
    "The email service did not confirm that it accepted this message. Valo will try again, and asks for this same message to be sent, not a second one.",
  ATTEMPT_LIMIT_REACHED:
    "Valo tried five times and stopped. The email service did not confirm that it accepted this message.",
  REPLAY_WINDOW_PASSED:
    "Valo could not confirm whether an earlier try went through, and it is now too late to try again safely. It has stopped, so that you do not get this message twice.",
  ORDER_NOT_VERIFIED:
    "This order's payment is no longer recorded as verified, so no message is sent about it.",
  REFUND_NOT_PROCESSED: "This refund is no longer recorded as processed, so no notice is sent about it.",
  RECIPIENT_NOT_A_MEMBER: "The person this message was for is no longer a member of this workspace.",
  PURCHASE_MESSAGE_HELD: "Valo is not sending messages about this purchase.",
  RECORD_NOT_FOUND: "The record this message was about is no longer in this workspace.",
};

/** The reasons the customer cannot clear alone: the screen offers the way to report a problem. */
const NEEDS_HELP = new Set(["ATTEMPT_LIMIT_REACHED", "REPLAY_WINDOW_PASSED"]);

type Told = Pick<WorkspaceMessage, "status" | "reason"> & { delivery?: MessageDelivery | null | undefined };

/** What a message's row is labelled: the email service's report about it, or else its state. */
export function messageLabel(message: Told) {
  return deliveryWords(message)?.label ?? MESSAGE_STATUS[message.status]?.label ?? message.status;
}

/**
 * What has happened to a message: what the email service reported about it, or else why it is in its
 * state. A reason this screen does not know says only what the state means.
 */
export function messageMeaning(message: Told) {
  return (
    deliveryWords(message)?.means ||
    (message.reason && REASONS[message.reason]) ||
    (MESSAGE_STATUS[message.status]?.means ?? "")
  );
}

/** Whether the customer needs someone at Valo to look at this message. */
export function messageNeedsHelp(message: Told) {
  return deliveryNeedsHelp(message) || (message.reason !== null && NEEDS_HELP.has(message.reason));
}

/** What a message is about, as its row's heading. */
export function messageSubject(message: Pick<WorkspaceMessage, "kind" | "orderReference">) {
  const kind = MESSAGE_KIND[message.kind] ?? "Message";
  return message.orderReference ? `${kind} for order ${message.orderReference}` : kind;
}

/** Where the record itself is, whatever became of its message. */
export function recordStays({ kind }: Pick<WorkspaceMessage, "kind">) {
  return kind === "refund_processed"
    ? "The refund itself is on your Purchases page."
    : "The receipt itself is on your Purchases page.";
}
