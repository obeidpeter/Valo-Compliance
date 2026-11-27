/** Only an explicitly configured development recipient can receive real email. */
export type ReminderSender = {
  replayWindowMs?: number | undefined;
  send(input: {
    idempotencyKey: string;
    ownerIdentityId: string;
    title: string;
    dueDate: string;
    timezone: "Africa/Lagos";
    signal: AbortSignal;
  }): Promise<{ providerMessageId: string }>;
};

/**
 * Thrown by a sender that will not send, because Valo has stopped sending optional messages to the
 * recipient's address: its email service sent a message back for good, or reported one as spam
 * (docs/architecture/messages.md, part 3). Nothing was sent. The worker cancels the reminder with this
 * reason, and does not try it again.
 */
export class ReminderAddressSuppressed extends Error {
  constructor() {
    super("EMAIL_ADDRESS_SUPPRESSED");
    this.name = "ReminderAddressSuppressed";
  }
}
