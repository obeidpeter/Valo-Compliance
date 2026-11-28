import type { MessageDelivery, ReminderRecord, ReminderRecordStatus } from "@workspace/api-client-react";
import { deliveryNeedsHelp, deliveryWords } from "./delivery-words";

/**
 * What a reminder's state is called, and what it means when no reason says more.
 *
 * "Accepted by email service" is not "delivered": Valo knows the email service took the message,
 * and does not know that it reached an inbox. No state is called delivered: that word is the email
 * service's own report (delivery-words.ts), shown only when it made one.
 */
export const REMINDER_STATUS: Record<ReminderRecordStatus, { label: string; means: string }> = {
  held: { label: "On hold", means: "Not sent. This reminder is on hold." },
  pending: { label: "Scheduled", means: "Not sent yet." },
  sent: {
    label: "Accepted by email service",
    means: "The email service accepted this message. That does not show it reached your inbox.",
  },
  cancelled: { label: "Cancelled", means: "It will not be sent." },
  failed: {
    label: "Not confirmed",
    means:
      "The email service did not confirm that it accepted this message. If Valo tries again, it asks for this same message to be sent, not a second one.",
  },
};

/** Why a reminder is in its state, by the reason the server records. */
const REASONS: Record<string, string> = {
  EMAIL_PROVIDER_NOT_CONFIGURED:
    "Reminder emails are not being sent yet. Your task and your preferences are saved.",
  EMAIL_REPLAY_WINDOW_EXPIRED:
    "Valo could not confirm whether an earlier try went through, and it is now too late to try again safely. This reminder is on hold so that you do not get it twice. Your task is saved.",
  EMAIL_FIRST_ATTEMPT_UNKNOWN:
    "Valo could not confirm when this reminder was first tried. It is on hold so that you do not get it twice. Your task is saved.",
  EMAIL_ATTEMPT_LIMIT_REACHED:
    "Valo tried five times and stopped. Your task and its due date have not changed.",
  EMAIL_DISPATCH_IN_PROGRESS: "Valo is sending this now. It has not been confirmed yet.",
  TASK_REVIEW_REQUIRED: "This task needs your review. Its reminders start again after that.",
  SOURCE_NO_LONGER_ELIGIBLE:
    "The guidance behind this task needs to be checked again. No reminder is sent from it.",
  REMINDERS_OPTED_OUT: "You turned reminders off before this one was sent.",
  PREFERENCES_CHANGED: "You changed your reminder preferences.",
  SCHEDULE_CHANGED: "The due date or the times you chose changed.",
  TASK_NO_LONGER_SCHEDULED: "The task is done or archived, or no longer has a due date you confirmed.",
  TASK_CHANGED: "The task was changed, so this earlier reminder was cancelled.",
  TASK_ARCHIVED: "The task was archived.",
  EMAIL_ADDRESS_SUPPRESSED:
    "Valo has stopped emailing the address this reminder was for: an earlier email to it came back, or was marked as spam. This reminder will not be sent. Your task is saved.",
};

/** The reasons the customer cannot clear alone: the screen offers the way to report a problem. */
const NEEDS_HELP = new Set([
  "EMAIL_ATTEMPT_LIMIT_REACHED",
  "EMAIL_FIRST_ATTEMPT_UNKNOWN",
  "EMAIL_ADDRESS_SUPPRESSED",
]);

type Told = Pick<ReminderRecord, "status" | "reason"> & { delivery?: MessageDelivery | null | undefined };

/** What a reminder's row is labelled: the email service's report about it, or else its state. */
export function reminderLabel(reminder: Told) {
  return deliveryWords(reminder)?.label ?? REMINDER_STATUS[reminder.status]?.label ?? reminder.status;
}

/**
 * What has happened to a reminder: what the email service reported about it, or else why it is in its
 * state. A reason this screen does not know says only what the state means.
 */
export function reminderMeaning(reminder: Told) {
  return (
    deliveryWords(reminder)?.means ||
    (reminder.reason && REASONS[reminder.reason]) ||
    (REMINDER_STATUS[reminder.status]?.means ?? "")
  );
}

/** Whether the customer needs someone at Valo to look at this reminder. */
export function reminderNeedsHelp(reminder: Told) {
  return deliveryNeedsHelp(reminder) || (reminder.reason !== null && NEEDS_HELP.has(reminder.reason));
}

/** How often Valo has tried, as a sentence. */
export function triedTimes(attempts: number) {
  return attempts === 1 ? "Tried once." : `Tried ${attempts} times.`;
}
