import { test } from "node:test";
import assert from "node:assert/strict";
import { findingWords, OUTCOME_WORDS } from "./payment-check-words";

// PAY-007 (docs/architecture/reconciliation.md, slices 1 and 2): finance reads what a daily payment check
// found in plain words, a sentence for each name its finding gives.
test("each name a daily payment check's finding gives is said in plain words, once, and a name Valo does not know is not hidden", () => {
  for (const name of [
    "AMOUNT_DIFFERENCE",
    "TRANSACTION_DIFFERENCE",
    "REVERSAL_DIFFERENCE",
    "ENTITLEMENT_DIFFERENCE",
    "RECEIPT_OUTBOX_MISSING",
    "EVENT_MISSING",
    "NO_ANSWER",
    "VERIFICATION_OR_FULFILMENT_DIFFERENCE",
    "PRIVACY_ERASURE_FINANCE_REVIEW",
  ]) {
    const [words, ...rest] = findingWords(name);
    assert.deepEqual(rest, [], name);
    assert.match(words!, /\.$/, name);
    assert.doesNotMatch(words!, /_[A-Z]|[A-Z]_/, `${name} is said in words, not as its name`);
    assert.doesNotMatch(words!, /Valo does not name/, `${name} has words of its own`);
  }
  assert.deepEqual(findingWords("EVENT_MISSING;ENTITLEMENT_DIFFERENCE"), [
    "The order has been paid for more than an hour, and Paystack's event for the payment has not arrived.",
    "The order is paid, and a template it bought is not available to the workspace, with no refund in full or dispute on record to explain it.",
  ]);
  assert.deepEqual(findingWords("EVENT_MISSING;EVENT_MISSING"), findingWords("EVENT_MISSING"));
  assert.deepEqual(findingWords("SOMETHING_NEW"), [
    "Something Valo does not name yet differs. Look at the order at Paystack.",
  ]);
  assert.deepEqual(Object.keys(OUTCOME_WORDS), ["explained", "no_payment_stands"]);
  assert.match(OUTCOME_WORDS.no_payment_stands.text, /stops asking Paystack/);
});
