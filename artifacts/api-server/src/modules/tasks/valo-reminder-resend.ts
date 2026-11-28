import { assertRecoveryEffectsAllowed } from "../../platform/valo-recovery-effects";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { clerkClient } from "@clerk/express";
import { z } from "zod";
import { sha256 } from "@workspace/valo-core";
import { trustedSiteOrigin } from "../../lib/valo-site-origin";
import { ReminderAddressSuppressed, type ReminderSender } from "./valo-reminder-sender";
import { reminderMessage } from "./reminder-message";
import { environment } from "../../platform/settings";
// The sender's shape only: the messages module itself, and the database schema it reads, load as a
// reminder is sent (below), not with every reader of the tasks code.
import type { MessageSender } from "../messages";

const envelope = z.email().max(254);
type Config = { from: string; recipient: string; origin: string };
type Proxy = (
  path: string,
  options: { method: string; body: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;
export function reminderEmailConfiguration(env: NodeJS.ProcessEnv = environment()): Config | null {
  // This adapter cannot enable production email or arbitrary-recipient sending.
  if (env.NODE_ENV !== "development" || !!env.REPLIT_DEPLOYMENT || env.VALO_EMAIL_MODE !== "development-test")
    return null;
  const from = envelope.safeParse(env.VALO_EMAIL_FROM),
    to = envelope.safeParse(env.VALO_EMAIL_TEST_RECIPIENT);
  const origin = trustedSiteOrigin(env);
  if (!from.success || !to.success || !origin?.startsWith("https://")) return null;
  return { from: from.data, recipient: to.data.toLowerCase(), origin };
}
/** How long the provider keeps an idempotency key is 24 hours. A retry stops before that: an old attempt
 * whose outcome is unknown must never become a fresh send. */
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
/** What the provider is sent of a message must be one line, with nothing to end a header early. */
const ONE_LINE = /^[\x20-\x7e]{1,998}$/;

/**
 * The development mailer as a sender of the shared kind (docs/architecture/messages.md, part 2). It sends
 * what it is handed, to the one test recipient, through the provider. Its gates are its own and do not
 * depend on the message: development only, never while a recovery is rehearsed, and only to the
 * configured test address, which must be the recipient's own verified one.
 *
 * `suppressed` says whether Valo has stopped sending optional messages to an address. It is asked of the
 * recipient's address just before the provider is called, for an optional message alone: such a message
 * to a suppressed address is not sent, and the answer says so. If the question cannot be asked, it throws,
 * and nothing is sent either.
 */
export function createResendMessageSender(
  config: Config,
  proxy: Proxy,
  verifiedRecipient: (identityId: string) => Promise<string | null>,
  suppressed: (address: string) => Promise<boolean>,
  env: NodeJS.ProcessEnv = environment(),
): MessageSender {
  return {
    name: "resend",
    replayWindowMs: REPLAY_WINDOW_MS,
    async send(message) {
      assertRecoveryEffectsAllowed(env);
      try {
        assertDevelopmentRuntime(env);
      } catch {
        throw Error("EMAIL_DEVELOPMENT_ONLY");
      }
      const recipient = await verifiedRecipient(message.recipient.identityId);
      if (!recipient || recipient.toLowerCase() !== config.recipient)
        throw Error("EMAIL_TEST_RECIPIENT_NOT_AUTHORIZED");
      if (message.optional && (await suppressed(recipient))) return { suppressed: true };
      // The key and the headers are the caller's own, made from checksums and fixed words. They are still
      // read before they are sent: nothing reaches the provider that could end a header or start another.
      if (!/^[A-Za-z0-9._-]{1,256}$/.test(message.idempotencyKey))
        throw Error("EMAIL_IDEMPOTENCY_KEY_INVALID");
      if (!ONE_LINE.test(message.subject)) throw Error("EMAIL_SUBJECT_INVALID");
      for (const [name, value] of Object.entries(message.headers ?? {}))
        if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || !ONE_LINE.test(value)) throw Error("EMAIL_HEADER_INVALID");
      const response = await proxy("/emails", {
        method: "POST",
        signal: message.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
        // A message with no headers or labels is sent without those two entries.
        body: JSON.stringify({
          from: `Valo <${config.from}>`,
          to: [recipient],
          subject: message.subject,
          text: message.text,
          headers: message.headers,
          tags: message.tags,
        }),
      });
      if (!response.ok)
        throw Error(response.status === 429 ? "EMAIL_PROVIDER_RATE_LIMITED" : "EMAIL_PROVIDER_NOT_ACCEPTED");
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 8192) throw Error("EMAIL_PROVIDER_RESPONSE_TOO_LARGE");
      const result = z.object({ id: z.uuid() }).parse(JSON.parse(text));
      return { providerMessageId: result.id }; // Acceptance only, never delivery.
    },
  };
}

/** The unsubscribe link's token for one reminder: the same on every attempt, so a retry is the same send. */
type UnsubscribeTokenFor = (about: {
  workspaceId: string;
  reminderId: string;
  identityId: string;
}) => string | Promise<string>;
/**
 * A reminder's sender over a sender of the shared kind: it makes the reminder's words, its unsubscribe
 * headers and its labels (reminder-message.ts), and hands them over as an optional message.
 *
 * `unsubscribeTokenFor` gives the token of the reminder's unsubscribe link
 * (docs/architecture/messages.md, part 4). A reminder is an optional message, so it never goes without
 * its link: if the token cannot be made, the sender is handed nothing.
 *
 * The key the provider deduplicates by is made from the reminder's own, and is the same on every
 * attempt, as the words are: a retry is the first request again.
 */
export function reminderSenderOver(
  sender: MessageSender,
  origin: string,
  unsubscribeTokenFor: UnsubscribeTokenFor,
): ReminderSender {
  return {
    replayWindowMs: sender.replayWindowMs,
    async send(input) {
      const token = await unsubscribeTokenFor({
        workspaceId: input.workspaceId,
        reminderId: input.reminderId,
        identityId: input.ownerIdentityId,
      });
      if (!/^[A-Za-z0-9._-]{1,200}$/.test(token)) throw Error("EMAIL_UNSUBSCRIBE_LINK_UNAVAILABLE");
      const reference = sha256(input.idempotencyKey);
      const answer = await sender.send({
        messageId: input.reminderId,
        idempotencyKey: `valo-reminder-v1-${reference}`,
        kind: "task_reminder",
        optional: true,
        recipient: { identityId: input.ownerIdentityId },
        ...reminderMessage({ origin, dueDate: input.dueDate, unsubscribeToken: token, reference }),
        signal: input.signal,
      });
      if ("suppressed" in answer) throw new ReminderAddressSuppressed();
      return answer;
    },
  };
}
/** The reminders' sender through the development mailer: the two above, joined. */
export function createResendReminderSender(
  config: Config,
  proxy: Proxy,
  verifiedRecipient: (identityId: string) => Promise<string | null>,
  suppressed: (address: string) => Promise<boolean>,
  unsubscribeTokenFor: UnsubscribeTokenFor,
  env: NodeJS.ProcessEnv = environment(),
): ReminderSender {
  return reminderSenderOver(
    createResendMessageSender(config, proxy, verifiedRecipient, suppressed, env),
    config.origin,
    unsubscribeTokenFor,
  );
}
export function automaticReminderDeliveryReady(env: NodeJS.ProcessEnv = environment()) {
  return env.VALO_EMAIL_OUTBOX_ENABLED === "development-test" && reminderEmailConfiguration(env) !== null;
}
export function configuredReminderSender(): ReminderSender | null {
  // Supplying a sender/test address must not silently release an existing
  // backlog. Automatic dispatch is a separate, default-off safety switch.
  if (!automaticReminderDeliveryReady()) return null;
  const config = reminderEmailConfiguration();
  if (!config) return null;
  const connectors = new ReplitConnectors();
  return createResendReminderSender(
    config,
    (path, options) => connectors.proxy("resend", path, options),
    async (identityId) => {
      const user = await clerkClient.users.getUser(identityId);
      if (user.banned || user.locked) return null;
      const primary = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
      return primary?.verification?.status === "verified" ? primary.emailAddress : null;
    },
    // The suppressions and the database schema they read load here, as a reminder is sent, not with every
    // reader of the tasks code.
    async (address) => (await import("../messages")).addressSuppressed(address),
    async (about) =>
      (await import("../messages")).unsubscribeToken({
        consent: "reminders",
        workspaceId: about.workspaceId,
        recordId: about.reminderId,
        identityId: about.identityId,
      }),
  );
}
