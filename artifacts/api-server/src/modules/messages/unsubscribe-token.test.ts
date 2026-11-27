import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import type { PrivacyKeys } from "../../lib/valo-privacy-keys";
import {
  readUnsubscribeToken,
  unsubscribeToken,
  UNSUBSCRIBE_CONSENTS,
  UNSUBSCRIBE_TOKEN_MAX,
} from "./unsubscribe-token";

/**
 * The unsubscribe link's token (docs/architecture/messages.md, part 4). Every key, workspace, record and
 * identity here is synthetic, and no database or network is used.
 */
const ring: PrivacyKeys = {
  current: "synthetic-key-2",
  keys: { "synthetic-key-2": "synthetic-current-key-".padEnd(40, "2") },
};
/** The keyring's current key, as the tests that sign for themselves need it. */
const currentKey = ring.keys[ring.current]!;
const about = {
  consent: "reminders",
  workspaceId: "00000000-0000-4000-8000-0000000000a1",
  recordId: "00000000-0000-4000-8000-0000000000b2",
  identityId: "synthetic-identity-owner",
} as const;

test("a link says what it stops, for which workspace and message, and whom it was made for, and nothing reads it but under its key", () => {
  const token = unsubscribeToken(about, ring);
  const link = readUnsubscribeToken(token, ring);
  assert.ok(link);
  assert.deepEqual(
    [link.consent, link.workspaceId, link.recordId],
    ["reminders", about.workspaceId, about.recordId],
  );
  assert.equal(link.madeFor(about.identityId), true);
  assert.equal(link.madeFor("synthetic-identity-another"), false);
  assert.equal(link.madeFor(""), false);
  // Another keyring's key of the same name does not read it, and neither does a keyring without the key.
  assert.equal(
    readUnsubscribeToken(token, {
      current: ring.current,
      keys: { [ring.current]: "synthetic-another-key-".padEnd(40, "3") },
    }),
    null,
  );
  assert.equal(
    readUnsubscribeToken(token, { current: "synthetic-key-9", keys: { "synthetic-key-9": currentKey } }),
    null,
  );
  assert.deepEqual([...UNSUBSCRIBE_CONSENTS], ["reminders"]);
});

test("the same message gets the same link on every attempt, and a different message, person or workspace a different one", () => {
  const token = unsubscribeToken(about, ring);
  // No time and nothing random is in it: a retried send carries the same words as the first.
  assert.equal(unsubscribeToken({ ...about }, ring), token);
  const others = [
    unsubscribeToken({ ...about, recordId: "00000000-0000-4000-8000-0000000000b3" }, ring),
    unsubscribeToken({ ...about, workspaceId: "00000000-0000-4000-8000-0000000000a2" }, ring),
    unsubscribeToken({ ...about, identityId: "synthetic-identity-another" }, ring),
  ];
  assert.equal(new Set([token, ...others]).size, 4);
  assert.ok(token.length <= UNSUBSCRIBE_TOKEN_MAX);
  assert.match(token, /^synthetic-key-2\.[A-Za-z0-9_-]{56}\.[A-Za-z0-9_-]{43}$/);
});

test("a link names no one: it holds neither the identity nor a plain checksum of it", () => {
  const token = unsubscribeToken(about, ring);
  const payload = Buffer.from(token.split(".")[1]!, "base64url");
  const plain = [
    Buffer.from(about.identityId),
    createHash("sha256").update(about.identityId).digest().subarray(0, 8),
    // A mark made under the keyring's key itself, and not under the key made for links.
    createHmac("sha256", currentKey)
      .update(`valo:unsubscribe-for:v1:${about.identityId}`)
      .digest()
      .subarray(0, 8),
  ];
  for (const bytes of plain) assert.equal(payload.includes(bytes), false);
  assert.doesNotMatch(token, /synthetic-identity/);
});

test("a link changed anywhere is no link, and neither is anything that is not one", () => {
  const token = unsubscribeToken(about, ring);
  const [version, payload, signature] = token.split(".") as [string, string, string];
  const other = (text: string, at: number) =>
    text.slice(0, at) + (text[at] === "A" ? "B" : "A") + text.slice(at + 1);
  const changed = [
    // Each part, at its first and a middle character: its last can spell the same bytes in base64.
    [version, other(payload, 0), signature].join("."),
    [version, other(payload, 30), signature].join("."),
    [version, payload, other(signature, 0)].join("."),
    [version, payload, other(signature, 20)].join("."),
    ["synthetic-key-1", payload, signature].join("."),
    // Parts missing, added or swapped.
    [version, payload].join("."),
    [version, payload, signature, signature].join("."),
    [version, signature, payload].join("."),
    // The same bytes in another spelling: padding, and the other base64 alphabet's characters.
    [version, payload + "=", signature].join("."),
    [version, payload, signature + "="].join("."),
    token + " ",
    " " + token,
    token.toUpperCase(),
  ];
  for (const each of changed) assert.equal(readUnsubscribeToken(each, ring), null, each);
  for (const notOne of [
    "",
    ".",
    "..",
    "a.b.c",
    "x".repeat(UNSUBSCRIBE_TOKEN_MAX + 1),
    null,
    undefined,
    7,
    {},
    [token],
  ])
    assert.equal(readUnsubscribeToken(notOne, ring), null, String(notOne));
  // A name that is no key's version, even one an object would answer to.
  for (const name of ["__proto__", "constructor", "toString", "has space"])
    assert.equal(readUnsubscribeToken([name, payload, signature].join("."), ring), null, name);
});

test("a correctly signed token of a form or a kind Valo does not know is not read", () => {
  // Signed as the module signs, by this test, to reach the checks that follow the signature.
  const key = createHmac("sha256", currentKey).update("valo:unsubscribe-key:v1").digest();
  const signed = (bytes: Buffer) => {
    const payload = bytes.toString("base64url");
    const signature = createHmac("sha256", key)
      .update(`valo:unsubscribe:v1:${ring.current}.${payload}`)
      .digest()
      .toString("base64url");
    return `${ring.current}.${payload}.${signature}`;
  };
  const real = Buffer.from(unsubscribeToken(about, ring).split(".")[1]!, "base64url");
  // The test's signing is the module's: the real payload, signed here, reads.
  assert.ok(readUnsubscribeToken(signed(real), ring));
  const withByte = (at: number, value: number) => {
    const copy = Buffer.from(real);
    copy[at] = value;
    return copy;
  };
  for (const bytes of [
    withByte(0, 2), // a later format
    withByte(0, 0),
    withByte(1, 0), // no kind
    withByte(1, 2), // a kind that is not there yet
    real.subarray(0, real.length - 1),
    Buffer.concat([real, Buffer.from([0])]),
    Buffer.alloc(0),
  ])
    assert.equal(readUnsubscribeToken(signed(bytes), ring), null, bytes.toString("hex"));
});

test("a link made under an earlier key still works while the keyring holds that key, and not after", () => {
  const earlier: PrivacyKeys = {
    current: "synthetic-key-1",
    keys: { "synthetic-key-1": "synthetic-earlier-key-".padEnd(40, "1") },
  };
  const token = unsubscribeToken(about, earlier);
  const both = { current: ring.current, keys: { ...earlier.keys, ...ring.keys } };
  const link = readUnsubscribeToken(token, both);
  assert.ok(link);
  assert.equal(link.madeFor(about.identityId), true);
  // A new link is made under the current key, and both read.
  const current = unsubscribeToken(about, both);
  assert.notEqual(current, token);
  assert.ok(readUnsubscribeToken(current, both));
  // The earlier key leaves the keyring: its links stop working.
  assert.equal(readUnsubscribeToken(token, ring), null);
});

test("a token is made only for a workspace and a record that are identifiers, and for someone", () => {
  for (const bad of [
    { ...about, workspaceId: "not-an-identifier" },
    { ...about, recordId: "" },
    { ...about, workspaceId: about.workspaceId.toUpperCase() },
    { ...about, identityId: "" },
    { ...about, identityId: "x".repeat(201) },
  ])
    assert.throws(() => unsubscribeToken(bad, ring), /UNSUBSCRIBE_TOKEN_SUBJECT_INVALID/);
});
