import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkspaceMessageKind, WorkspaceMessageStatus } from "@workspace/api-client-react";
import { DELIVERY } from "./delivery-words";
import {
  MESSAGE_KIND,
  MESSAGE_STATUS,
  messageLabel,
  messageMeaning,
  messageNeedsHelp,
  messageSubject,
  recordStays,
} from "./message-words";

const STATUSES = Object.values(WorkspaceMessageStatus);
/** Every reason the API's message code records, as it is spelt there. */
const RECORDED = [
  "SENDER_NOT_CONFIGURED",
  "MESSAGES_PAUSED",
  "SENDER_DID_NOT_TAKE",
  "ATTEMPT_LIMIT_REACHED",
  "REPLAY_WINDOW_PASSED",
  "WORKSPACE_ERASED",
  "RECIPIENT_NOT_A_MEMBER",
  "RECORD_NOT_FOUND",
  "ORDER_NOT_VERIFIED",
  "REFUND_NOT_PROCESSED",
  "PURCHASE_MESSAGE_HELD",
];
/** Words of the system's own, which a customer is not asked to know. */
const SYSTEM_WORDS =
  /\bprovider\b|\bdispatch|\bidempoten|\breplay\b|\bserver\b|\boutbox\b|\bsender\b|\bstand-in\b|\bqueue|[A-Z]{3,}_[A-Z]/;

test("every state of a message has a name and a meaning, in words a customer is not asked to learn", () => {
  for (const status of STATUSES) {
    const { label, means } = MESSAGE_STATUS[status];
    assert.ok(label && means, status);
    assert.doesNotMatch(label + " " + means, SYSTEM_WORDS, status);
  }
  for (const status of STATUSES)
    for (const reason of RECORDED) {
      const said = messageMeaning({ status, reason });
      assert.ok(said.length > 10, `${status} ${reason}`);
      assert.doesNotMatch(said, SYSTEM_WORDS, `${status} ${reason}: ${said}`);
    }
  for (const kind of Object.values(WorkspaceMessageKind)) assert.ok(MESSAGE_KIND[kind], kind);
});

test("no state of a message is called sent or delivered, a message Valo only recorded is called not emailed, and only the email service's report is called delivered", () => {
  for (const status of STATUSES) {
    assert.doesNotMatch(MESSAGE_STATUS[status].label, /\bsent\b|\bdelivered\b/i, status);
    // With no report from the email service, a message's label is its state's, whatever the state.
    assert.equal(messageLabel({ status, reason: null }), MESSAGE_STATUS[status].label);
    assert.equal(messageLabel({ status, reason: null, delivery: null }), MESSAGE_STATUS[status].label);
  }
  // The email service's report is what the row says, in the report's own words.
  const reported = { status: "accepted", reason: null, delivery: "delivered" } as const;
  assert.equal(messageLabel(reported), "Delivered");
  assert.equal(messageMeaning(reported), DELIVERY.delivered.means);
  assert.match(messageMeaning(reported), /^The email service reports that this message was delivered\./);
  // The email service took it, and that is all Valo knows.
  assert.equal(MESSAGE_STATUS.accepted.label, "Accepted by email service");
  assert.equal(
    MESSAGE_STATUS.accepted.means,
    "The email service accepted this message. That does not show it reached your inbox.",
  );
  // Nothing left Valo: it is never called accepted, and its words claim no email.
  assert.equal(MESSAGE_STATUS.recorded.label, "Not emailed");
  assert.equal(
    MESSAGE_STATUS.recorded.means,
    "Nothing was emailed: Valo was not sending emails when this message was due.",
  );
  assert.doesNotMatch(MESSAGE_STATUS.recorded.label + MESSAGE_STATUS.recorded.means, /accept/i);
  // A message the service did not confirm is not called sent, and is not called lost either.
  assert.equal(MESSAGE_STATUS.failed.label, "Not confirmed");
});

test("a reason says why; a reason this screen does not know says only what the state means", () => {
  assert.equal(
    messageMeaning({ status: "held", reason: "SENDER_NOT_CONFIGURED" }),
    "Valo is not sending emails yet. Nothing has been emailed.",
  );
  assert.equal(
    messageMeaning({ status: "held", reason: "MESSAGES_PAUSED" }),
    "Valo has paused its messages for now. This one waits until they start again.",
  );
  assert.equal(
    messageMeaning({ status: "cancelled", reason: "ORDER_NOT_VERIFIED" }),
    "This order's payment is no longer recorded as verified, so no message is sent about it.",
  );
  // A reason with no sentence of its own, or one added later, is not guessed at.
  assert.equal(messageMeaning({ status: "cancelled", reason: "WORKSPACE_ERASED" }), "It will not be sent.");
  assert.equal(messageMeaning({ status: "cancelled", reason: "SOMETHING_NEW" }), "It will not be sent.");
  assert.equal(messageMeaning({ status: "queued", reason: null }), "Not sent yet.");
  assert.equal(messageMeaning({ status: "recorded", reason: null }), MESSAGE_STATUS.recorded.means);
});

test("only what the customer cannot clear alone offers the way to report a problem", () => {
  assert.deepEqual(
    RECORDED.filter((reason) => messageNeedsHelp({ status: "failed", reason })),
    ["ATTEMPT_LIMIT_REACHED", "REPLAY_WINDOW_PASSED"],
  );
  assert.equal(messageNeedsHelp({ status: "held", reason: null }), false);
  // A message the email service itself could not send is Valo's to look at. One that came back, was
  // delayed or was marked as spam is not something Valo's staff can clear.
  assert.deepEqual(
    Object.keys(DELIVERY).filter((delivery) =>
      messageNeedsHelp({ status: "accepted", reason: null, delivery: delivery as keyof typeof DELIVERY }),
    ),
    ["undelivered"],
  );
});

test("a message is named by what it is and the order it is about, and its record is said to stay", () => {
  assert.equal(
    messageSubject({ kind: "purchase_receipt", orderReference: "valo-test-1" }),
    "Receipt for order valo-test-1",
  );
  assert.equal(
    messageSubject({ kind: "refund_processed", orderReference: "valo-test-1" }),
    "Refund notice for order valo-test-1",
  );
  // An order the workspace no longer holds is not named.
  assert.equal(messageSubject({ kind: "purchase_receipt", orderReference: null }), "Receipt");
  assert.equal(recordStays({ kind: "purchase_receipt" }), "The receipt itself is on your Purchases page.");
  assert.equal(recordStays({ kind: "refund_processed" }), "The refund itself is on your Purchases page.");
});
