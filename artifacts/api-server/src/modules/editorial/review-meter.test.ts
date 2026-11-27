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
test("a request is measured against the limit of its kind, and the limit is part of what is recorded", () => {
  const request = { content: "x".repeat(32000) };
  const usual = meterReviewRequest(request);
  assert.equal(usual.inputCeiling, 32000);
  assert.equal(usual.withinInputCeiling, false);
  // The same request under a larger limit: the same measure, a different answer and a different record.
  const larger = meterReviewRequest(request, 64000);
  assert.equal(larger.inputCeiling, 64000);
  assert.equal(larger.withinInputCeiling, true);
  assert.equal(larger.conservativeInputTokenBound, usual.conservativeInputTokenBound);
  assert.equal(larger.requestHash, usual.requestHash);
  assert.notDeepEqual(larger, usual);
  assert.equal(meterReviewRequest({ content: "x".repeat(64000) }, 64000).withinInputCeiling, false);
  for (const invalid of [0, -1, 1.5, Number.NaN, Infinity])
    assert.throws(() => meterReviewRequest(request, invalid), /REVIEW_INPUT_CEILING_INVALID/);
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
