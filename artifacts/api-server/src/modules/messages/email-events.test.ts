import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DELIVERIES, emailWebhookKeys, resendEvents, saysMore, type Delivery } from "./email-events";

/**
 * The delivery reports' signature and reading (docs/architecture/messages.md, part 3), with no database
 * and no provider: the scheme's published example, and bodies this test signs with a key of its own.
 */

/** The example the signature scheme's documentation publishes: a key, a message and its signature. */
const PUBLISHED = {
  secret: "whsec_plJ3nmyCDGBKInavdOK15jsl",
  id: "msg_loFOjxBNrRLzqYUf",
  timestamp: "1731705121",
  body: '{"event_type":"ping","data":{"success":true}}',
  signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
};
const publishedKeys = emailWebhookKeys(PUBLISHED.secret)!;
const publishedNow = new Date(Number(PUBLISHED.timestamp) * 1000);
const headers = (values: Record<string, string | undefined>) => (name: string) => values[name];
const publishedHeaders = (change: Record<string, string | undefined> = {}) =>
  headers({
    "svix-id": PUBLISHED.id,
    "svix-timestamp": PUBLISHED.timestamp,
    "svix-signature": PUBLISHED.signature,
    ...change,
  });

/** A key of this test's own, and a body signed with it as the scheme describes. */
const ownSecret = "whsec_" + Buffer.from("synthetic-email-webhook-key-0001").toString("base64");
const ownKeys = emailWebhookKeys(ownSecret)!;
function signed(body: string, at: Date, id = "msg_synthetic_1", key = ownKeys[0]!) {
  const stamp = String(Math.floor(+at / 1000));
  const signature = createHmac("sha256", key).update(`${id}.${stamp}.${body}`).digest("base64");
  return headers({ "svix-id": id, "svix-timestamp": stamp, "svix-signature": "v1," + signature });
}
const NOW = new Date("2026-11-27T09:00:00Z");
const event = (type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type,
    created_at: "2026-11-27T08:59:30.000Z",
    data: {
      email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
      from: "Valo <synthetic-sender@example.test>",
      to: ["synthetic-recipient@example.test"],
      subject: "SYNTHETIC SUBJECT NEVER KEPT",
      ...data,
    },
    ...extra,
  });

test("the signature scheme's published example verifies, and no changed part of it does", () => {
  const body = Buffer.from(PUBLISHED.body);
  assert.equal(resendEvents.authentic(body, publishedHeaders(), publishedKeys, publishedNow), true);
  // The body exactly as it was sent: one more space is another body.
  assert.equal(
    resendEvents.authentic(
      Buffer.from(PUBLISHED.body + " "),
      publishedHeaders(),
      publishedKeys,
      publishedNow,
    ),
    false,
  );
  for (const change of [
    { "svix-id": "msg_loFOjxBNrRLzqYUg" },
    { "svix-timestamp": "1731705122" },
    // One character of the signature changed: its first, and one in its middle.
    { "svix-signature": "v1,sAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" },
    { "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlJktD0=" },
    // Another version's signature, a signature with no version, and none.
    { "svix-signature": "v2,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" },
    { "svix-signature": "rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" },
    { "svix-signature": "v1," },
    { "svix-signature": undefined },
    { "svix-id": undefined },
    { "svix-timestamp": undefined },
    { "svix-timestamp": "yesterday" },
    { "svix-timestamp": "1731705121.5" },
  ])
    assert.equal(
      resendEvents.authentic(body, publishedHeaders(change), publishedKeys, publishedNow),
      false,
      JSON.stringify(change),
    );
  // Another key does not verify it; nor does no key at all.
  assert.equal(resendEvents.authentic(body, publishedHeaders(), ownKeys, publishedNow), false);
  assert.equal(resendEvents.authentic(body, publishedHeaders(), [], publishedNow), false);
});

test("a signature is taken only within five minutes of its time, either way, so a copied request is refused later", () => {
  const body = Buffer.from(PUBLISHED.body);
  const at = (seconds: number) => new Date(+publishedNow + seconds * 1000);
  for (const [seconds, taken] of [
    [0, true],
    [299, true],
    [300, true],
    [301, false],
    [3600, false],
    // Signed for a time still to come: a clock that far out is not the provider's.
    [-300, true],
    [-301, false],
  ] as const)
    assert.equal(
      resendEvents.authentic(body, publishedHeaders(), publishedKeys, at(seconds)),
      taken,
      `${seconds}s`,
    );
});

test("one matching signature among several is enough, and either of two keys verifies while a secret is replaced", () => {
  const body = event("email.delivered");
  const header = signed(body, NOW);
  const stamp = header("svix-timestamp")!;
  const several = headers({
    "svix-id": "msg_synthetic_1",
    "svix-timestamp": stamp,
    "svix-signature": `v1,${Buffer.alloc(32, 7).toString("base64")} ${header("svix-signature")} v1a,ignored`,
  });
  assert.equal(resendEvents.authentic(Buffer.from(body), several, ownKeys, NOW), true);
  // The old secret and the new one together: a body signed with either verifies.
  const both = emailWebhookKeys(`${PUBLISHED.secret}, ${ownSecret}`)!;
  assert.equal(both.length, 2);
  assert.equal(resendEvents.authentic(Buffer.from(body), header, both, NOW), true);
  assert.equal(
    resendEvents.authentic(Buffer.from(PUBLISHED.body), publishedHeaders(), both, publishedNow),
    true,
  );
  // Signed with a key that is neither.
  const other = Buffer.from("synthetic-email-webhook-key-0002");
  assert.equal(
    resendEvents.authentic(Buffer.from(body), signed(body, NOW, "msg_synthetic_1", other), both, NOW),
    false,
  );
});

test("the setting gives signing keys only when every part of it is one, so a mistyped secret takes nothing", () => {
  assert.equal(emailWebhookKeys(undefined), null);
  assert.equal(emailWebhookKeys(""), null);
  assert.equal(emailWebhookKeys("   "), null);
  assert.deepEqual(
    emailWebhookKeys(PUBLISHED.secret)?.map((key) => key.length),
    [18],
  );
  assert.deepEqual(
    emailWebhookKeys(ownSecret)?.map((key) => key.toString()),
    ["synthetic-email-webhook-key-0001"],
  );
  for (const mistyped of [
    "plJ3nmyCDGBKInavdOK15jsl",
    "whsec_",
    "whsec_short",
    "whsec_not base64 at all!!!!!!!!!!!",
    PUBLISHED.secret + ",",
    PUBLISHED.secret + ",whsec_short",
    "sk_test_" + "x".repeat(32),
  ])
    assert.equal(emailWebhookKeys(mistyped), null, mistyped);
});

test("each event Valo uses becomes a report that keeps the message's reference, the time and a bounce's kind, and nothing of the address or subject", () => {
  const read = (body: string) => resendEvents.read(Buffer.from(body), signed(body, NOW));
  for (const [type, data, delivery, detail] of [
    ["email.delivered", {}, "delivered", null],
    ["email.delivery_delayed", {}, "delayed", null],
    [
      "email.bounced",
      { bounce: { type: "Permanent", message: "SYNTHETIC BOUNCE TEXT" } },
      "bounced",
      "PERMANENT",
    ],
    ["email.bounced", { bounce: { type: "Transient" } }, "bounced", "TEMPORARY"],
    ["email.bounced", { bounce: { type: "Temporary" } }, "bounced", "TEMPORARY"],
    ["email.bounced", { bounce: { type: "Undetermined" } }, "bounced", "UNDETERMINED"],
    ["email.bounced", {}, "bounced", "UNDETERMINED"],
    ["email.complained", {}, "complained", null],
    ["email.failed", { failed: { reason: "SYNTHETIC FAILURE TEXT" } }, "undelivered", "PROVIDER_FAILED"],
    ["email.suppressed", {}, "undelivered", "PROVIDER_SUPPRESSED"],
  ] as const) {
    const { eventKey, report } = read(event(type, data));
    assert.equal(eventKey, "msg_synthetic_1");
    assert.deepEqual(
      report,
      {
        delivery,
        detail,
        providerMessageId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
        occurredAt: new Date("2026-11-27T08:59:30.000Z"),
      },
      type,
    );
    assert.doesNotMatch(JSON.stringify(report), /example\.test|SYNTHETIC/, type);
  }
  // Every report it can make is one the records can hold.
  assert.deepEqual([...DELIVERIES].sort(), ["bounced", "complained", "delayed", "delivered", "undelivered"]);
});

test("an event Valo does not use leaves no report: that a message was handed over, opened, or a link in it followed", () => {
  for (const type of [
    "email.sent",
    "email.opened",
    "email.clicked",
    "email.received",
    "email.scheduled",
    "contact.created",
    "domain.updated",
    // A name an object already has is not an event.
    "constructor",
    "toString",
  ]) {
    const body = event(type);
    assert.deepEqual(resendEvents.read(Buffer.from(body), signed(body, NOW)), {
      eventKey: "msg_synthetic_1",
      report: null,
    });
  }
});

test("a report keeps the event's own time, or the time it was signed when the event gives none it can use", () => {
  const signedAt = new Date(Math.floor(+NOW / 1000) * 1000);
  const at = (extra: Record<string, unknown>) => {
    const body = event("email.delivered", {}, extra);
    return resendEvents.read(Buffer.from(body), signed(body, NOW)).report!.occurredAt;
  };
  // A report made yesterday and delivered again today keeps yesterday's time.
  assert.deepEqual(at({ created_at: "2026-11-26T08:00:00Z" }), new Date("2026-11-26T08:00:00Z"));
  assert.deepEqual(at({ created_at: undefined }), signedAt);
  assert.deepEqual(at({ created_at: "not a time" }), signedAt);
  // A time after the signing is not the provider's.
  assert.deepEqual(at({ created_at: "2026-11-27T09:05:00Z" }), new Date("2026-11-27T09:05:00Z"));
  assert.deepEqual(at({ created_at: "2026-11-27T09:05:01Z" }), signedAt);
  assert.deepEqual(at({ created_at: "2031-01-01T00:00:00Z" }), signedAt);
});

test("a body that names no message, or is not in the provider's form, is refused and nothing is read from it", () => {
  const read = (body: string, header = signed(body, NOW)) => resendEvents.read(Buffer.from(body), header);
  assert.throws(() => read(event("email.delivered", { email_id: undefined })), /EMAIL_EVENT_WITHOUT_MESSAGE/);
  assert.throws(() => read(event("email.bounced", { email_id: "" })));
  assert.throws(() => read(event("email.delivered", { email_id: "x".repeat(201) })));
  assert.throws(() => read("not json"));
  assert.throws(() => read("[]"));
  assert.throws(() => read(JSON.stringify({ data: { email_id: "synthetic" } })));
  assert.throws(() => read(JSON.stringify({ type: "email.delivered" })), /EMAIL_EVENT_WITHOUT_MESSAGE/);
  // The provider's id for the report is what makes a second delivery of it the same report.
  const body = event("email.delivered");
  assert.throws(() => read(body, headers({ "svix-timestamp": "1795770000" })), /EMAIL_EVENT_WITHOUT_ID/);
});

test("a report replaces another only if it says more, so the reports about one message end the same in any order", () => {
  const settle = (reports: readonly Delivery[]) =>
    reports.reduce<Delivery | null>((held, report) => (saysMore(report, held) ? report : held), null);
  const orders = <T>(items: readonly T[]): T[][] =>
    items.length < 2
      ? [[...items]]
      : items.flatMap((item, i) => orders(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]));
  for (const [reports, ends] of [
    [["delayed", "delivered"], "delivered"],
    [["delayed", "delivered", "complained"], "complained"],
    [["delayed", "bounced"], "bounced"],
    [["delivered", "bounced"], "bounced"],
    [["undelivered", "delayed"], "undelivered"],
    [["undelivered", "bounced"], "bounced"],
    [["delayed", "delivered", "undelivered", "bounced", "complained"], "complained"],
  ] as const)
    for (const order of orders(reports)) assert.equal(settle(order), ends, order.join(" then "));
  // The same report again changes nothing, and anything says more than nothing.
  for (const delivery of DELIVERIES) {
    assert.equal(saysMore(delivery, delivery), false, delivery);
    assert.equal(saysMore(delivery, null), true, delivery);
    assert.equal(saysMore(delivery, undefined), true, delivery);
  }
});
