/** Only an explicitly configured development recipient can receive real email. */
export type ReminderSender = {
  replayWindowMs?: number;
  send(input: {
    idempotencyKey: string;
    ownerIdentityId: string;
    title: string;
    dueDate: string;
    timezone: "Africa/Lagos";
    signal: AbortSignal;
  }): Promise<{ providerMessageId: string }>;
};
