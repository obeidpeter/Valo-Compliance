import test from "node:test";
import assert from "node:assert/strict";
import { meterReviewRequest, providerUsage } from "./review-meter";
test("review meters bind exact bytes and reject oversized text before any reservation", () => {
  const a = meterReviewRequest({ messages: [{ content: "Plain operational form ₦" }] });
  assert.equal(a.withinInputCeiling, true);
  assert.equal(a.actualBilling, null);
  assert.equal(a.conservativeInputTokenBound, a.wireBytes + 1024);
  assert.notEqual(
    a.requestHash,
    meterReviewRequest({ messages: [{ content: "Changed form ₦" }] }).requestHash,
  );
  assert.equal(meterReviewRequest({ content: "x".repeat(32000) }).withinInputCeiling, false);
});
test("unknown usage/billing is not zero and unsafe provider counters are not trusted", () => {
  assert.deepEqual(providerUsage(undefined), { inputTokens: null, outputTokens: null, actualBilling: null });
  assert.deepEqual(providerUsage({ prompt_tokens: 18, completion_tokens: 3 }), {
    inputTokens: 18,
    outputTokens: 3,
    actualBilling: null,
  });
  assert.equal(providerUsage({ prompt_tokens: -1, completion_tokens: Infinity }).inputTokens, null);
  assert.equal(providerUsage({ completion_tokens: Infinity }).outputTokens, null);
});
