import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * What an email provider can report about a message it took, as Valo records it
 * (docs/architecture/messages.md, part 3):
 * - `delivered`: the address's email service took the message. Nothing shows that anyone read it, or
 *   which folder it is in.
 * - `delayed`: the provider has not managed to hand it over yet, and is still trying.
 * - `bounced`: the address's email service refused it.
 * - `complained`: the address's email service says it was marked as spam.
 * - `undelivered`: the provider could not send it, or will not send to that address.
 */
export const DELIVERIES = ["delivered", "delayed", "bounced", "complained", "undelivered"] as const;
export type Delivery = (typeof DELIVERIES)[number];

export const isDelivery = (value: unknown): value is Delivery =>
  typeof value === "string" && (DELIVERIES as readonly string[]).includes(value);

/**
 * How much each report says. A report replaces the one a record holds only if it says more: a message
 * delayed and then delivered is delivered, one delivered and then marked as spam is complained, and a
 * report that arrives late and says less changes nothing. No two say as much as each other, so the reports
 * about one message leave the same record in whatever order they arrive, and a report delivered twice
 * changes nothing.
 */
const SAYS: Record<Delivery, number> = {
  delayed: 1,
  delivered: 2,
  undelivered: 3,
  bounced: 4,
  complained: 5,
};
export function saysMore(report: Delivery, than: Delivery | null | undefined) {
  return than == null || SAYS[report] > SAYS[than];
}

/** One report, with the least Valo keeps of it: no address, subject or text. */
export type EmailReport = {
  delivery: Delivery;
  /** The kind of a bounce or of a failure, as a code. */
  detail: string | null;
  /** The provider's reference for the message, as the sender returned it when it took the message. */
  providerMessageId: string;
  /** The provider's time for the report. */
  occurredAt: Date;
};

type Header = (name: string) => string | undefined;

/**
 * The delivery reports of one email provider. Another provider needs only an object of this type.
 */
export type EmailEventSource = {
  /** The provider's name: the sender a message was taken by, for this provider's reports to be about it. */
  provider: string;
  /** Whether the body is the provider's own: signed with one of the keys, and signed just now. */
  authentic(body: Buffer, header: Header, keys: readonly Buffer[], now?: Date): boolean;
  /**
   * The provider's id for this report, and what it says. The report is null for an event Valo keeps
   * nothing of, such as one saying a message was opened. Throws on a body it cannot read.
   *
   * `address` is the one address the message went to, given only for a report that may suppress it (a
   * bounce or a complaint), so that its keyed checksum can be made. It is no part of the report, and
   * nothing keeps it.
   */
  read(
    body: Buffer,
    header: Header,
  ): { eventKey: string; report: EmailReport | null; address: string | null };
};

/**
 * The signing keys in `VALO_EMAIL_WEBHOOK_SECRET`: one, or several separated by commas while a secret is
 * being replaced. Each is `whsec_` and then the key in base64. Null when the setting is unset or any part
 * of it is not of that form: the webhook then answers that it is not set up, and takes nothing.
 */
export function emailWebhookKeys(value: string | undefined): Buffer[] | null {
  const parts = (value ?? "").split(",").map((part) => part.trim());
  if (parts.some((part) => !/^whsec_[A-Za-z0-9+/]{24,88}={0,2}$/.test(part))) return null;
  return parts.map((part) => Buffer.from(part.slice("whsec_".length), "base64"));
}

/** How far a report's signed time may be from now, either way. Older, and a copied request is refused. */
const SIGNED_WITHIN_MS = 5 * 60_000;

/**
 * Whether a body carries one of the keys' signatures, in the scheme the provider's documentation
 * describes (read 26 November 2026; no request of the provider's has been checked against it):
 * - the headers `svix-id`, `svix-timestamp` (seconds) and `svix-signature`;
 * - the signed text is the id, the timestamp and the body exactly as sent, joined by full stops;
 * - the signature is that text's HMAC-SHA256 under the key, in base64, after `v1,`; the header may hold
 *   several, separated by spaces, and one that matches is enough.
 *
 * The scheme's published example verifies here (email-events.test.ts). The time must be within five
 * minutes of now, and each comparison takes the same time whatever differs.
 */
function signedBy(body: Buffer, header: Header, keys: readonly Buffer[], now = new Date()) {
  const id = header("svix-id"),
    stamp = header("svix-timestamp"),
    signatures = header("svix-signature");
  if (!id || !stamp || !signatures || id.length > 200 || signatures.length > 2000) return false;
  if (!/^\d{1,12}$/.test(stamp) || Math.abs(+now - Number(stamp) * 1000) > SIGNED_WITHIN_MS) return false;
  const given = signatures
    .split(" ")
    .filter((signature) => signature.startsWith("v1,"))
    .slice(0, 8)
    .map((signature) => Buffer.from(signature.slice(3), "base64"))
    .filter((signature) => signature.length === 32);
  const signed = Buffer.concat([Buffer.from(`${id}.${stamp}.`, "utf8"), body]);
  let matched = false;
  for (const key of keys) {
    const expected = createHmac("sha256", key).update(signed).digest();
    for (const signature of given) if (timingSafeEqual(expected, signature)) matched = true;
  }
  return matched;
}

/**
 * Only what Valo reads of an event. The subject and the rest are never read. The address is read only to
 * make its keyed checksum, for a bounce or a complaint (valo-email-suppression.ts), and is kept nowhere.
 */
const resendEvent = z.object({
  type: z.string().min(1).max(80),
  created_at: z.string().max(60).optional(),
  data: z
    .object({
      email_id: z.string().min(1).max(200).optional(),
      bounce: z.object({ type: z.string().max(60).optional() }).optional(),
      to: z.array(z.string().max(320)).max(50).optional(),
    })
    .optional(),
});

/**
 * What each of the provider's events reports, as its documentation lists them (read 26 November 2026).
 * An event that is not here is one Valo keeps nothing of: that a message was handed to the provider, which
 * the message's own record already says, and that one was opened or a link in it followed, which Valo
 * does not track.
 */
const RESEND_REPORTS = new Map<string, { delivery: Delivery; detail: string | null }>([
  ["email.delivered", { delivery: "delivered", detail: null }],
  ["email.delivery_delayed", { delivery: "delayed", detail: null }],
  ["email.bounced", { delivery: "bounced", detail: null }],
  ["email.complained", { delivery: "complained", detail: null }],
  ["email.failed", { delivery: "undelivered", detail: "PROVIDER_FAILED" }],
  ["email.suppressed", { delivery: "undelivered", detail: "PROVIDER_SUPPRESSED" }],
]);

/** A bounce's kind: whether the address's email service refused the message for good. */
function bounceKind(type: string | undefined) {
  const kind = (type ?? "").toLowerCase();
  if (kind === "permanent") return "PERMANENT";
  return kind === "transient" || kind === "temporary" ? "TEMPORARY" : "UNDETERMINED";
}

/**
 * The delivery reports of Resend, the provider the development reminder adapter sends through
 * (modules/tasks/valo-reminder-resend.ts).
 */
export const resendEvents: EmailEventSource = {
  provider: "resend",
  authentic: signedBy,
  read(body, header) {
    const eventKey = header("svix-id");
    if (!eventKey || eventKey.length > 200) throw Error("EMAIL_EVENT_WITHOUT_ID");
    const event = resendEvent.parse(JSON.parse(body.toString("utf8")));
    const known = RESEND_REPORTS.get(event.type);
    if (!known) return { eventKey, report: null, address: null };
    if (!event.data?.email_id) throw Error("EMAIL_EVENT_WITHOUT_MESSAGE");
    // The event's own time, or the time it was signed when the event gives none that can be read. A
    // time later than the signing is not the provider's, and is not kept.
    const signedAt = new Date(Number(header("svix-timestamp")) * 1000);
    const said = event.created_at ? new Date(event.created_at) : signedAt;
    const occurredAt =
      Number.isNaN(+said) || +said > +signedAt + SIGNED_WITHIN_MS || +said < 0 ? signedAt : said;
    if (Number.isNaN(+occurredAt)) throw Error("EMAIL_EVENT_WITHOUT_TIME");
    // Valo sends each message to one address. A report naming several, or none, suppresses none.
    const to = event.data.to ?? [];
    const address =
      (known.delivery === "bounced" || known.delivery === "complained") &&
      to.length === 1 &&
      /^[^\s@]+@[^\s@]+$/.test(to[0]!)
        ? to[0]!
        : null;
    return {
      eventKey,
      report: {
        delivery: known.delivery,
        detail: known.delivery === "bounced" ? bounceKind(event.data.bounce?.type) : known.detail,
        providerMessageId: event.data.email_id,
        occurredAt,
      },
      address,
    };
  },
};
