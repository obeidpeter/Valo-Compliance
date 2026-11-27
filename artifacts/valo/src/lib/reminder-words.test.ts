import assert from "node:assert/strict";
import { test } from "node:test";
import { ReminderRecordStatus } from "@workspace/api-client-react";
import { DELIVERY } from "./delivery-words";
import {
  REMINDER_STATUS,
  reminderLabel,
  reminderMeaning,
  reminderNeedsHelp,
  triedTimes,
} from "./reminder-words";

const STATUSES = Object.values(ReminderRecordStatus);
/** Every reason the API's reminder code records, as it is spelt there. */
const RECORDED = [
  "EMAIL_PROVIDER_NOT_CONFIGURED",
  "EMAIL_REPLAY_WINDOW_EXPIRED",
  "EMAIL_FIRST_ATTEMPT_UNKNOWN",
  "EMAIL_ATTEMPT_LIMIT_REACHED",
  "EMAIL_ACCEPTANCE_UNCONFIRMED",
  "EMAIL_DISPATCH_IN_PROGRESS",
  "TASK_REVIEW_REQUIRED",
  "SOURCE_NO_LONGER_ELIGIBLE",
  "REMINDERS_OPTED_OUT",
  "PREFERENCES_CHANGED",
  "SCHEDULE_CHANGED",
  "TASK_NO_LONGER_SCHEDULED",
  "TASK_CHANGED",
  "TASK_ARCHIVED",
  "EMAIL_ADDRESS_SUPPRESSED",
];
/** Words of the system's own, which a customer is not asked to know. */
const SYSTEM_WORDS =
  /\bprovider\b|\bdispatch|\bidempoten|\breplay\b|\bserver\b|\boutbox\b|\bEMAIL_|[A-Z]{3,}_[A-Z]/;

test("every state of a reminder has a name and a meaning, in words a customer is not asked to learn", () => {
  for (const status of STATUSES) {
    const { label, means } = REMINDER_STATUS[status];
    assert.ok(label && means, status);
    assert.doesNotMatch(label + " " + means, SYSTEM_WORDS, status);
  }
  for (const status of STATUSES)
    for (const reason of RECORDED) {
      const said = reminderMeaning({ status, reason });
      assert.ok(said.length > 10, `${status} ${reason}`);
      assert.doesNotMatch(said, SYSTEM_WORDS, `${status} ${reason}: ${said}`);
    }
});

test("an accepted message is never called sent or delivered: the email service took it, and that is all Valo knows", () => {
  const { label, means } = REMINDER_STATUS.sent;
  assert.equal(label, "Accepted by email service");
  assert.equal(means, "The email service accepted this message. That does not show it reached your inbox.");
  for (const status of STATUSES) {
    assert.doesNotMatch(REMINDER_STATUS[status].label, /\bsent\b|\bdelivered\b/i, status);
    // With no report from the email service, a reminder's label is its state's.
    assert.equal(reminderLabel({ status, reason: null }), REMINDER_STATUS[status].label);
  }
  // A message the service did not confirm is not called sent, and is not called lost either.
  assert.equal(REMINDER_STATUS.failed.label, "Not confirmed");
  // Only the email service's own report calls a reminder delivered, and the row then says what it reported.
  const reported = { status: "sent", reason: null, delivery: "delivered" } as const;
  assert.equal(reminderLabel(reported), "Delivered");
  assert.equal(reminderMeaning(reported), DELIVERY.delivered.means);
  assert.equal(reminderLabel({ ...reported, delivery: "bounced" }), "Not delivered");
  assert.equal(reminderNeedsHelp({ ...reported, delivery: "undelivered" }), true);
  assert.equal(reminderNeedsHelp({ ...reported, delivery: "bounced" }), false);
});

test("a reason says why; a reason this screen does not know says only what the state means", () => {
  assert.equal(
    reminderMeaning({ status: "held", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" }),
    "Reminder emails are not being sent yet. Your task and your preferences are saved.",
  );
  assert.equal(reminderMeaning({ status: "cancelled", reason: "TASK_ARCHIVED" }), "The task was archived.");
  // An unconfirmed try has no sentence of its own: the state's meaning already says it.
  assert.equal(
    reminderMeaning({ status: "failed", reason: "EMAIL_ACCEPTANCE_UNCONFIRMED" }),
    REMINDER_STATUS.failed.means,
  );
  // A reminder Valo would not send says why, what happens to it and that the task is safe. It says
  // nothing of an earlier try, which the row's count of tries does.
  assert.equal(
    reminderMeaning({ status: "cancelled", reason: "EMAIL_ADDRESS_SUPPRESSED" }),
    "Valo has stopped emailing the address this reminder was for: an earlier email to it came back, or was marked as spam. This reminder will not be sent. Your task is saved.",
  );
  // Every recorded reason but the unconfirmed try has a sentence of its own, so a reason the server
  // records and this file does not know is noticed here.
  for (const reason of RECORDED.filter((each) => each !== "EMAIL_ACCEPTANCE_UNCONFIRMED"))
    assert.notEqual(
      reminderMeaning({ status: "cancelled", reason }),
      REMINDER_STATUS.cancelled.means,
      reason,
    );
  // A cancelled reminder with a reason added later is not described as paused.
  assert.equal(reminderMeaning({ status: "cancelled", reason: "SOMETHING_NEW" }), "It will not be sent.");
  assert.equal(reminderMeaning({ status: "pending", reason: null }), "Not sent yet.");
});

test("only what the customer cannot clear alone offers the way to report a problem", () => {
  assert.deepEqual(
    RECORDED.filter((reason) => reminderNeedsHelp({ status: "held", reason })),
    ["EMAIL_FIRST_ATTEMPT_UNKNOWN", "EMAIL_ATTEMPT_LIMIT_REACHED", "EMAIL_ADDRESS_SUPPRESSED"],
  );
  assert.equal(reminderNeedsHelp({ status: "held", reason: null }), false);
});

test("the number of tries reads as a sentence", () => {
  assert.equal(triedTimes(1), "Tried once.");
  assert.equal(triedTimes(5), "Tried 5 times.");
});
