import test from "node:test";
import assert from "node:assert/strict";
import { lagosDate, lagosTime, naira, noticesMessage, receiptMessage, refundMessage } from "./message-text";
import { configuredMessageSender, standInSender, type OutgoingMessage } from "./message-sender";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MESSAGE_ATTEMPT_LIMIT,
  MESSAGE_KINDS,
  NOTICES_MESSAGE_DAYS_BACK,
  NOTICES_MESSAGE_HOUR,
  NOTICES_NAMED,
  messageRetryAt,
  noticesOpenDay,
} from "./message-policy";

const outgoing = (key: string, signal = new AbortController().signal): OutgoingMessage => ({
  messageId: "00000000-0000-4000-8000-000000000001",
  idempotencyKey: key,
  kind: "purchase_receipt",
  recipient: { identityId: "synthetic-message-recipient" },
  subject: "Synthetic subject",
  text: "Synthetic text",
  signal,
});

test("a message writes amounts in naira and times on a Lagos clock, as the screens do (WRK-003, PAY-009)", () => {
  assert.equal(naira(150000), "₦1,500.00");
  assert.equal(naira(12345), "₦123.45");
  assert.equal(naira(5), "₦0.05");
  assert.equal(naira(123456789012), "₦1,234,567,890.12");
  for (const bad of [-1, 1.5, Number.NaN]) assert.throws(() => naira(bad), /MESSAGE_AMOUNT_INVALID/);
  // 08:00 UTC is 09:00 in Lagos, which keeps no summer time; late on 31 December UTC is already 1 January.
  assert.equal(lagosTime(new Date("2026-11-18T08:00:00Z")), "18 Nov 2026, 09:00");
  assert.equal(lagosTime(new Date("2026-12-31T23:30:00Z")), "1 Jan 2027, 00:30");
});

test("a receipt message names the order and what it is not, links to the purchases page and has no unsubscribe link (PAY-009, WRK-004)", () => {
  const order = {
    reference: "valo-test-synthetic-order",
    title: "Synthetic premium template",
    amountKobo: 250000,
    recordedAt: new Date("2026-11-18T08:00:00Z"),
    testMode: true,
  };
  const message = receiptMessage(order, "https://valo.example.test");
  assert.equal(message.subject, "Your Valo receipt for order valo-test-synthetic-order");
  for (const words of [
    "Order: valo-test-synthetic-order",
    "Bought: Synthetic premium template",
    "Amount: ₦2,500.00",
    "Recorded: 18 Nov 2026, 09:00 (Lagos time)",
    "Your receipt is on your purchases page: https://valo.example.test/workspace/purchases",
    "It is not a business invoice, a government receipt or an official tax invoice.",
    "no real money was taken",
    "You receive this message because you made this purchase.",
    "so it has no unsubscribe link",
  ])
    assert.ok(message.text.includes(words), words);
  // Without a configured address it says where to look instead of linking anywhere.
  const unlinked = receiptMessage({ ...order, testMode: false }, null);
  assert.ok(
    unlinked.text.includes("Your receipt is on your purchases page: open Valo and choose Purchases."),
  );
  assert.ok(!unlinked.text.includes("http"));
  assert.ok(!unlinked.text.includes("test mode"));
  // A message holds no address and never says it was delivered.
  for (const text of [message.text, unlinked.text]) {
    assert.ok(!text.includes("@"));
    assert.doesNotMatch(text, /deliver/i);
  }
});

test("a refund message says a processed refund is not yet the bank's credit, and an unconfirmed amount is not guessed (PAY-008)", () => {
  const refund = {
    orderReference: "valo-test-synthetic-order",
    refundReference: "valo-refund-synthetic",
    amountKobo: 100000,
    processedAt: new Date("2026-11-19T10:15:00Z"),
    testMode: true,
  };
  const message = refundMessage(refund, "https://valo.example.test");
  assert.equal(message.subject, "Your Valo refund on order valo-test-synthetic-order was processed");
  for (const words of [
    "The payment provider has confirmed a refund on your order.",
    "Refund: valo-refund-synthetic",
    "Amount: ₦1,000.00",
    "Processed: 19 Nov 2026, 11:15 (Lagos time)",
    "A processed refund is not yet confirmation that your bank has credited your account.",
    "no real money moved",
    "so it has no unsubscribe link",
  ])
    assert.ok(message.text.includes(words), words);
  assert.ok(
    refundMessage({ ...refund, amountKobo: null }, null).text.includes(
      "Amount: not confirmed by the provider",
    ),
  );
});

/** A day's notices as the message is given them: synthetic titles, in Valo's own words. */
const dayOfNotices = {
  day: "2026-11-18",
  rules: [
    { title: "Synthetic rule: file the annual return", kind: "withdrawn" as const },
    { title: "Synthetic rule: register for tax", kind: "replaced" as const },
  ],
  moreRules: 0,
  templates: [{ title: "Synthetic template: employment contract" }],
  moreTemplates: 0,
  corrections: 3,
};

test("a notices message names the day, each changed requirement and withdrawn template, and how many saved items to review, and links to the workspace page (EDP-011, WRK-004)", () => {
  const message = noticesMessage(dayOfNotices, "https://valo.example.test");
  assert.equal(message.subject, "Changes on 18 Nov 2026 that affect your Valo workspace");
  assert.equal(
    message.text,
    [
      "On 18 Nov 2026 Valo recorded changes that affect what you saved, made or bought in your workspace.",
      "",
      "Requirements Valo checks:",
      "- Withdrawn: Synthetic rule: file the annual return",
      "- Replaced by a later version: Synthetic rule: register for tax",
      "",
      "Templates:",
      "- Withdrawn: Synthetic template: employment contract",
      "",
      "Saved items to review:",
      "- 3 of your tasks, saved results, documents or purchases used a source or a version that is now held or withdrawn. What you saved and the files you made are unchanged.",
      "",
      "Each change, and what it affects, is on your workspace page: https://valo.example.test/workspace",
      "",
      "You receive this message because these changes affect what you saved, made or bought in Valo. It is a necessary message about your account, so it has no unsubscribe link.",
    ].join("\n"),
  );
  // A part with nothing in it is left out, heading and all.
  const rulesOnly = noticesMessage({ ...dayOfNotices, templates: [], corrections: 0 }, null);
  assert.ok(rulesOnly.text.includes("Requirements Valo checks:"));
  for (const absent of ["Templates:", "Saved items to review:", "http"])
    assert.ok(!rulesOnly.text.includes(absent), absent);
  // Without a configured address it says where to look instead of linking anywhere.
  assert.ok(
    rulesOnly.text.includes(
      "Each change, and what it affects, is on your workspace page: open Valo and choose Workspace.",
    ),
  );
  const correctionsOnly = noticesMessage({ ...dayOfNotices, rules: [], templates: [], corrections: 1 }, null);
  assert.ok(correctionsOnly.text.includes("- 1 of your tasks, saved results, documents or purchases used"));
  for (const absent of ["Requirements Valo checks:", "Templates:"])
    assert.ok(!correctionsOnly.text.includes(absent), absent);
  // A message holds no address and never says it was delivered.
  for (const text of [message.text, rulesOnly.text, correctionsOnly.text]) {
    assert.ok(!text.includes("@"));
    assert.doesNotMatch(text, /deliver/i);
  }
});

test("a notices message counts what it does not name, and writes each title on one line of its own (EDP-011)", () => {
  const many = noticesMessage(
    {
      ...dayOfNotices,
      rules: [{ title: "  Synthetic rule\nwith a break\r\n- Withdrawn: a forged line  ", kind: "withdrawn" }],
      moreRules: 4,
      templates: [{ title: "T".repeat(500) }],
      moreTemplates: 1,
      corrections: 0,
    },
    null,
  );
  const lines = many.text.split("\n");
  // A title's own line breaks are spaces, so it cannot start a line of the message.
  assert.ok(lines.includes("- Withdrawn: Synthetic rule with a break - Withdrawn: a forged line"));
  assert.ok(lines.includes("- and 4 more requirements"));
  assert.ok(lines.includes("- and 1 more template"));
  assert.ok(lines.includes(`- Withdrawn: ${"T".repeat(200)}`));
  assert.equal(lines.filter((line) => line.startsWith("- ")).length, 4);
  // The day is written as the site writes a date, and only a real day is taken.
  assert.equal(lagosDate("2026-01-05"), "5 Jan 2026");
  assert.equal(lagosDate("2027-12-31"), "31 Dec 2027");
  for (const bad of [
    "2026-13-01",
    "2026-00-10",
    "2026-11-00",
    "2026-11-32",
    "18 Nov 2026",
    "2026-11-18T00:00:00Z",
    "",
  ])
    assert.throws(() => lagosDate(bad), /MESSAGE_DAY_INVALID/, bad);
});

test("a day's notices are emailed from 07:00 the next morning on a Lagos clock, for a week back, naming ten of each sort (EDP-011)", () => {
  assert.equal(NOTICES_MESSAGE_HOUR, 7);
  assert.equal(NOTICES_MESSAGE_DAYS_BACK, 7);
  assert.equal(NOTICES_NAMED, 10);
  // Lagos is an hour ahead of UTC all year. Until 07:00 there, the day before is not yet owed its message.
  assert.equal(noticesOpenDay(new Date("2026-11-19T05:59:59Z")), "2026-11-18");
  assert.equal(noticesOpenDay(new Date("2026-11-19T06:00:00Z")), "2026-11-19");
  assert.equal(noticesOpenDay(new Date("2026-11-19T22:59:59Z")), "2026-11-19");
  // Midnight in Lagos, and the turn of a year: still the old day until its morning.
  assert.equal(noticesOpenDay(new Date("2026-12-31T23:30:00Z")), "2026-12-31");
  assert.equal(noticesOpenDay(new Date("2027-01-01T05:59:59Z")), "2026-12-31");
  assert.equal(noticesOpenDay(new Date("2027-01-01T06:00:00Z")), "2027-01-01");
});

test("each kind of message is necessary, and a message is offered five times at most, with a growing wait (WRK-003)", () => {
  assert.deepEqual(MESSAGE_KINDS, {
    purchase_receipt: "necessary",
    refund_processed: "necessary",
    notices_digest: "necessary",
  });
  assert.equal(MESSAGE_ATTEMPT_LIMIT, 5);
  const now = new Date("2026-11-18T08:00:00Z");
  assert.deepEqual(
    [1, 2, 3, 4].map((attempt) => (+messageRetryAt(attempt, now)! - +now) / 60000),
    [1, 2, 4, 8],
  );
  assert.equal(messageRetryAt(5, now), null);
  for (const bad of [0, -1, 1.5]) assert.throws(() => messageRetryAt(bad, now), /INVALID_MESSAGE_ATTEMPT/);
});

test("the stand-in sends nothing, gives one reference to each idempotency key and keeps messages only when asked (WRK-003)", async () => {
  const keeping = standInSender({ keep: true });
  assert.equal(keeping.name, "stand-in");
  const first = await keeping.send(outgoing("key-one")),
    again = await keeping.send(outgoing("key-one")),
    other = await keeping.send(outgoing("key-two"));
  assert.match(first.providerMessageId, /^stand-in-[0-9a-f-]{36}$/);
  assert.equal(again.providerMessageId, first.providerMessageId);
  assert.notEqual(other.providerMessageId, first.providerMessageId);
  assert.equal(keeping.kept.length, 3);
  assert.ok(!("signal" in keeping.kept[0]!));
  assert.equal(keeping.kept[0]!.recipient.identityId, "synthetic-message-recipient");
  const silent = standInSender();
  await silent.send(outgoing("key-three"));
  assert.equal(silent.kept.length, 0);
  // An aborted attempt and a refusing stand-in take nothing.
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(silent.send(outgoing("key-four", aborted.signal)));
  await assert.rejects(
    standInSender({ refuse: () => true }).send(outgoing("key-five")),
    /MESSAGE_STAND_IN_REFUSED/,
  );
});

test("the worker's sender is the stand-in only when its setting says so, and never in production (WRK-003)", () => {
  assert.equal(configuredMessageSender({ NODE_ENV: "development" }), null);
  assert.equal(configuredMessageSender({ NODE_ENV: "development", VALO_MESSAGE_SENDER: "" }), null);
  assert.equal(
    configuredMessageSender({ NODE_ENV: "development", VALO_MESSAGE_SENDER: "stand-in" })?.name,
    "stand-in",
  );
  assert.throws(
    () => configuredMessageSender({ NODE_ENV: "production", VALO_MESSAGE_SENDER: "stand-in" }),
    /MessageSenderStandInInProduction: VALO_MESSAGE_SENDER/,
  );
  for (const value of ["resend", "Stand-in", " stand-in", "stand-in "])
    assert.throws(
      () => configuredMessageSender({ NODE_ENV: "development", VALO_MESSAGE_SENDER: value }),
      /MessageSenderSettingInvalid: VALO_MESSAGE_SENDER/,
    );
});

test("the design note shows the owner each message's words as the code composes them (WRK-003)", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../../../../../docs/architecture/messages.md", import.meta.url)),
    "utf8",
  );
  const origin = "https://valo.example";
  const shown = [
    receiptMessage(
      {
        reference: "valo-example-order",
        title: "Employment contract pack",
        amountKobo: 1500000,
        recordedAt: new Date("2026-11-18T08:00:00Z"),
        testMode: true,
      },
      origin,
    ),
    refundMessage(
      {
        orderReference: "valo-example-order",
        refundReference: "valo-example-refund",
        amountKobo: 1500000,
        processedAt: new Date("2026-11-20T13:30:00Z"),
        testMode: true,
      },
      origin,
    ),
    noticesMessage(
      {
        day: "2026-11-18",
        rules: [
          { title: "File the company's annual return", kind: "replaced" },
          { title: "Register a food product", kind: "withdrawn" },
        ],
        moreRules: 0,
        templates: [{ title: "Employment contract pack" }],
        moreTemplates: 0,
        corrections: 2,
      },
      origin,
    ),
  ];
  for (const message of shown)
    assert.ok(
      page.includes("```text\nSubject: " + message.subject + "\n\n" + message.text + "\n```"),
      message.subject,
    );
});
