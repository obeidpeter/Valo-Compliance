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
  /**
   * True for a message its reader may stop, such as a reminder (part 4). Before it sends one, a sender
   * asks whether Valo has stopped sending optional messages to the address (part 3), and sends nothing if
   * it has, or if it cannot ask.
   */
  optional?: boolean | undefined;
  recipient: { identityId: string };
  subject: string;
  text: string;
  /** Headers for the reader's mail program: an optional message's unsubscribe pair (part 4). */
  headers?: Readonly<Record<string, string>> | undefined;
  /** Labels the provider keeps with a message. None names a person or holds any of a message's words. */
  tags?: readonly { name: string; value: string }[] | undefined;
  signal: AbortSignal;
};

/**
 * What a sender answers. Its reference means it took the message, never that the message reached anyone.
 * `suppressed` means it sent nothing, because the message is optional and Valo has stopped sending
 * optional messages to its address. Only an optional message is answered so.
 */
export type SenderAnswer = { providerMessageId: string } | { suppressed: true };

/** Takes one message and answers as above, or throws. */
export type MessageSender = {
  /** The name recorded on each message it takes. */
  name: string;
  /** How long the sender deduplicates by idempotency key. Past it, an attempt that may have been taken is
   * never made again, since it could send the message twice. */
  replayWindowMs?: number | undefined;
  send(message: OutgoingMessage): Promise<SenderAnswer>;
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
  // It answers every message with a reference: it holds no address, so none is one Valo has stopped
  // sending to.
  const sender: Omit<MessageSender, "send"> & {
    kept: readonly KeptMessage[];
    send(message: OutgoingMessage): Promise<{ providerMessageId: string }>;
  } = {
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
