/**
 * A reminder's words, and what else of it a sender is handed (docs/architecture/messages.md, parts 2
 * and 4): the headers a mail program reads to offer its own unsubscribe button, and the labels the
 * provider keeps. Nothing here reads the database or calls anyone.
 *
 * The words name no task, no person and no business: only the due date, and where to open Valo. They hold
 * no time and nothing random, so a retried reminder is the same message to a provider that compares them.
 */
export function reminderMessage(about: {
  /** The site's own address, with no slash at its end. */
  origin: string;
  dueDate: string;
  /** The token of this reminder's unsubscribe link (modules/messages/unsubscribe-token.ts). */
  unsubscribeToken: string;
  /** A checksum of the reminder's own key. It tells one reminder from another and names nothing. */
  reference: string;
}) {
  return {
    subject: "Your Valo task reminder",
    // Do not send document bodies, task notes, names or raw task titles.
    text: `You opted in to Valo task reminders.\n\nA task has the confirmed due date ${about.dueDate} (Africa/Lagos).\nOpen Valo to view your tasks: ${about.origin}/\n\nYou can turn off reminders in your Valo notification preferences, or stop them without signing in: ${about.origin}/unsubscribe?t=${about.unsubscribeToken}\n\nThis message is a development test, not a regulatory confirmation.`,
    // For a mail program's own unsubscribe button (RFC 8058): the address it posts to, and that one press
    // is enough. The form is the one the provider's documentation gives, read on 27 November 2026; no
    // request has been checked against it.
    headers: {
      "List-Unsubscribe": `<${about.origin}/api/public/unsubscribe/one-click?t=${about.unsubscribeToken}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [
      { name: "purpose", value: "development_task_reminder" },
      { name: "notification_ref", value: about.reference },
    ],
  };
}
