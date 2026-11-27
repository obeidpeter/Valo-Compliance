import { createHmac, timingSafeEqual } from "node:crypto";
import { privacyKeys, type PrivacyKeys } from "../../lib/valo-privacy-keys";

/**
 * The token in an optional message's unsubscribe link (docs/architecture/messages.md, part 4). It lets
 * whoever holds the message stop that kind of message, with no sign-in, and lets them do nothing else.
 *
 * What a token says, and under what:
 * - the kind of optional message it stops, which is the consent it withdraws;
 * - the workspace, and the record that carried the link, a reminder;
 * - a mark of the person the message was for, made under the link's key. It tells that person from
 *   another and cannot be turned back into their identifier, so a link names no one to whoever reads
 *   the address it sits in;
 * - a signature under a key made for these links alone, from the privacy keyring's key of the named
 *   version. A link cannot be used as anything else, and nothing else can be used as a link.
 *
 * A token has no time in it and no random part: the same message gets the same link on every attempt, so
 * a retried send is the same send to a provider that compares them. It does not expire. It stops working
 * when its key leaves the keyring, and the page then says where the choice is made in Valo.
 */
export const UNSUBSCRIBE_CONSENTS = ["reminders"] as const;
export type UnsubscribeConsent = (typeof UNSUBSCRIBE_CONSENTS)[number];

/** What a link is for, as its reader is given it. `madeFor` says whether it was made for an identity. */
export type UnsubscribeLink = {
  consent: UnsubscribeConsent;
  workspaceId: string;
  recordId: string;
  madeFor(identityId: string): boolean;
};

const FORMAT = 1;
/** Each consent's number in a token. A number is never given a second meaning. */
const CODES: Record<UnsubscribeConsent, number> = { reminders: 1 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_VERSION = /^[a-zA-Z0-9_-]{1,80}$/;
/** Format, consent, workspace, record, and the mark of whom it was for. */
const PAYLOAD_BYTES = 2 + 16 + 16 + 8;
/** The longest token there can be: a key's version, the payload and the signature, with their two stops. */
export const UNSUBSCRIBE_TOKEN_MAX = 80 + 1 + 56 + 1 + 43;

const idBytes = (id: string) => {
  if (!UUID.test(id)) throw Error("UNSUBSCRIBE_TOKEN_SUBJECT_INVALID");
  return Buffer.from(id.replaceAll("-", ""), "hex");
};
const idText = (bytes: Buffer) => {
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
};
/** The key these links are signed under: made from a keyring key, and used for nothing else. */
const linkKey = (key: string) => createHmac("sha256", key).update("valo:unsubscribe-key:v1").digest();
const markOf = (key: Buffer, identityId: string) =>
  createHmac("sha256", key).update(`valo:unsubscribe-for:v1:${identityId}`).digest().subarray(0, 8);
const signatureOf = (key: Buffer, version: string, payload: string) =>
  createHmac("sha256", key).update(`valo:unsubscribe:v1:${version}.${payload}`).digest();

/**
 * The token for one message's unsubscribe link, under the keyring's current key. The same message gets
 * the same token for as long as that key is current.
 */
export function unsubscribeToken(
  about: { consent: UnsubscribeConsent; workspaceId: string; recordId: string; identityId: string },
  ring: PrivacyKeys = privacyKeys(),
) {
  if (!about.identityId || about.identityId.length > 200) throw Error("UNSUBSCRIBE_TOKEN_SUBJECT_INVALID");
  const version = ring.current;
  const key = linkKey(ring.keys[version]!);
  const payload = Buffer.concat([
    Buffer.from([FORMAT, CODES[about.consent]]),
    idBytes(about.workspaceId),
    idBytes(about.recordId),
    markOf(key, about.identityId),
  ]).toString("base64url");
  return `${version}.${payload}.${signatureOf(key, version, payload).toString("base64url")}`;
}

/**
 * What a token is for, or null for anything that is not a token Valo signed under a key it still holds.
 * A token is read whole: one whose spelling is not the one Valo wrote is not read, even if it would
 * decode to the same bytes.
 */
export function readUnsubscribeToken(
  token: unknown,
  ring: PrivacyKeys = privacyKeys(),
): UnsubscribeLink | null {
  if (typeof token !== "string" || token.length > UNSUBSCRIBE_TOKEN_MAX) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, payload, signature] = parts as [string, string, string];
  if (!KEY_VERSION.test(version) || !Object.hasOwn(ring.keys, version)) return null;
  const bytes = Buffer.from(payload, "base64url"),
    signed = Buffer.from(signature, "base64url");
  if (bytes.toString("base64url") !== payload || signed.toString("base64url") !== signature) return null;
  if (bytes.length !== PAYLOAD_BYTES || signed.length !== 32) return null;
  const key = linkKey(ring.keys[version]!);
  if (!timingSafeEqual(signed, signatureOf(key, version, payload))) return null;
  if (bytes[0] !== FORMAT) return null;
  const consent = UNSUBSCRIBE_CONSENTS.find((each) => CODES[each] === bytes[1]);
  if (!consent) return null;
  const mark = bytes.subarray(34, 42);
  return {
    consent,
    workspaceId: idText(bytes.subarray(2, 18)),
    recordId: idText(bytes.subarray(18, 34)),
    madeFor: (identityId) => timingSafeEqual(mark, markOf(key, identityId)),
  };
}
