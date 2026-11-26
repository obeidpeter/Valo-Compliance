import { randomUUID } from "node:crypto";
import { environment } from "../../platform/settings";

/**
 * What a sender is handed for one message (docs/architecture/messages.md, part 2). The recipient is an
 * identity: a real sender reads that identity's verified address when it sends, never one stored here. The
 * idempotency key is the message's own and stays the same on every attempt, so a provider that deduplicates
 * by it sends a retried message once.
 */
export type OutgoingMessage = {
  messageId: string;
  idempotencyKey: string;
  kind: string;
  recipient: { identityId: string };
  subject: string;
  text: string;
  signal: AbortSignal;
};

/**
 * Takes one message and returns the reference it gave it, or throws. A reference means the sender took the
 * message, never that it reached anyone.
 */
export type MessageSender = {
  /** The name recorded on each message it takes. */
  name: string;
  /** How long the sender deduplicates by idempotency key. Past it, an attempt that may have been taken is
   * never made again, since it could send the message twice. */
  replayWindowMs?: number | undefined;
  send(message: OutgoingMessage): Promise<{ providerMessageId: string }>;
};

/**
 * The stand-in's name, as each message it takes records it. A message this sender took was sent to no one:
 * the workspace's log says so, and never calls it accepted by an email service.
 */
export const STAND_IN_SENDER = "stand-in";

/** A message the stand-in was handed, as a test reads it. */
export type KeptMessage = Omit<OutgoingMessage, "signal"> & { providerMessageId: string };

/**
 * The stand-in sender (part 2). It sends nothing to anyone. It gives each message a reference of its own, the
 * same one for every attempt with the same idempotency key, as a provider that deduplicates would. With
 * `keep`, it keeps each message it was handed, for a test to read; the worker's stand-in keeps none, so no
 * message's words stay in memory.
 */
export function standInSender(options: { keep?: boolean; refuse?: () => boolean } = {}) {
  const references = new Map<string, string>();
  const kept: KeptMessage[] = [];
  const sender: MessageSender & { kept: readonly KeptMessage[] } = {
    name: STAND_IN_SENDER,
    kept,
    async send(message) {
      message.signal.throwIfAborted();
      if (options.refuse?.()) throw Error("MESSAGE_STAND_IN_REFUSED");
      let providerMessageId = references.get(message.idempotencyKey);
      if (!providerMessageId) {
        providerMessageId = `stand-in-${randomUUID()}`;
        references.set(message.idempotencyKey, providerMessageId);
      }
      if (options.keep) {
        const { signal: _signal, ...rest } = message;
        kept.push({ ...rest, providerMessageId });
      }
      return { providerMessageId };
    },
  };
  return sender;
}

/**
 * The sender the worker uses, from `VALO_MESSAGE_SENDER`. Only the stand-in exists: a real sender waits for
 * the owner's approval of a provider and a sender address (part 2). Unset, there is none, and every message
 * waits. The stand-in is refused in production, where no worker job runs: a production message is never
 * recorded as taken by a sender that sends nothing.
 */
export function configuredMessageSender(env: NodeJS.ProcessEnv = environment()): MessageSender | null {
  const choice = env.VALO_MESSAGE_SENDER;
  if (choice === undefined || choice === "") return null;
  if (choice !== STAND_IN_SENDER) throw Error("MessageSenderSettingInvalid: VALO_MESSAGE_SENDER");
  if (env.NODE_ENV === "production") throw Error("MessageSenderStandInInProduction: VALO_MESSAGE_SENDER");
  return standInSender();
}
