import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageDelivery } from "@workspace/api-client-react";
import { DELIVERY, deliveryNeedsHelp, deliveryWords } from "./delivery-words";

const DELIVERIES = Object.values(MessageDelivery);
/** Words of the system's own, which a customer is not asked to know. */
const SYSTEM_WORDS =
  /\bprovider\b|\bdispatch|\bserver\b|\bwebhook\b|\bbounce|\bcomplain|\bsuppress|\boutbox\b|\bsender\b|[A-Z]{3,}_[A-Z]/i;

test("every report from the email service has a name and a meaning, in words a customer is not asked to learn", () => {
  assert.deepEqual(Object.keys(DELIVERY).sort(), [...DELIVERIES].sort());
  for (const delivery of DELIVERIES) {
    const { label, means, tone } = DELIVERY[delivery];
    assert.ok(label && means.length > 20 && /^pill-[a-z]+$/.test(tone), delivery);
    assert.doesNotMatch(label + " " + means, SYSTEM_WORDS, delivery);
    assert.equal(deliveryWords({ delivery }), DELIVERY[delivery]);
  }
  // Nothing reported is nothing to say.
  assert.equal(deliveryWords({ delivery: null }), null);
  assert.equal(deliveryWords({}), null);
});

test("delivered is said to be the email service's report, with what Valo cannot see, and no other report is called delivered", () => {
  assert.equal(DELIVERY.delivered.label, "Delivered");
  assert.equal(
    DELIVERY.delivered.means,
    "The email service reports that this message was delivered. Valo cannot see whether it was opened, or which folder it went to.",
  );
  for (const delivery of DELIVERIES.filter((delivery) => delivery !== "delivered")) {
    assert.doesNotMatch(DELIVERY[delivery].label, /^delivered$|\bsent\b/i, delivery);
    assert.notEqual(DELIVERY[delivery].tone, DELIVERY.delivered.tone, delivery);
  }
  // No report claims that anyone read the message.
  for (const delivery of DELIVERIES) assert.doesNotMatch(DELIVERY[delivery].means, /\bread\b|\bseen\b/i);
});

test("a message that came back says the address may be wrong, and only one the email service could not send needs Valo's help", () => {
  assert.equal(DELIVERY.bounced.label, "Not delivered");
  assert.match(DELIVERY.bounced.means, /The email address may be wrong or no longer in use\.$/);
  assert.equal(DELIVERY.undelivered.label, "Not delivered");
  assert.equal(DELIVERY.complained.label, "Marked as spam");
  assert.equal(DELIVERY.delayed.label, "Delayed");
  assert.deepEqual(
    DELIVERIES.filter((delivery) => deliveryNeedsHelp({ delivery })),
    ["undelivered"],
  );
  assert.equal(deliveryNeedsHelp({ delivery: null }), false);
});
