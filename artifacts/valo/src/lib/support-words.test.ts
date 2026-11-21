import assert from "node:assert/strict";
import { test } from "node:test";
import { SUPPORT_STATUS_WORDS, supportStatusWords, supportTopic } from "./support-words";

test("where a support request stands is said in words, for each state the API sends", () => {
  assert.deepEqual(SUPPORT_STATUS_WORDS, {
    open: "Waiting for staff",
    in_progress: "With a member of staff",
    awaiting_customer: "Staff have replied",
    resolved: "Resolved",
  });
  for (const words of Object.values(SUPPORT_STATUS_WORDS)) assert.doesNotMatch(words, /_/);
  // A state added later keeps its own name, spelt in words, and is not passed off as another.
  assert.equal(supportStatusWords("awaiting_customer"), "Staff have replied");
  assert.equal(supportStatusWords("on_hold"), "on hold");
});

test("what a request is about is named as the form named it", () => {
  assert.equal(supportTopic("support"), "Valo product support");
  assert.equal(supportTopic("sector_approval"), "Sector approvals and permits");
  assert.equal(supportTopic("account_access"), "account access");
});
