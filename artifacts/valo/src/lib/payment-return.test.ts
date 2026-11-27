import assert from "node:assert/strict";
import test from "node:test";
import { ORDER_STATUS_LABELS } from "./order-status-words";
import { returnStep, returnWords, returnedReference, withoutReturn } from "./payment-return";

// PAY-006 (docs/architecture/order-safety.md, slice 3).

test("an order's reference is read from the address under either of its two names, and nothing else is taken for one", () => {
  assert.equal(returnedReference("?trxref=valo-test-1&reference=valo-test-1"), "valo-test-1");
  assert.equal(returnedReference("reference=ORD.SYNTH_2"), "ORD.SYNTH_2");
  assert.equal(returnedReference("?trxref=valo-test-3"), "valo-test-3");
  // The screen's own choice of an offer is not a reference, and an address without one has none.
  assert.equal(returnedReference("?offer=00000000-0000-4000-8000-000000000001"), null);
  assert.equal(returnedReference(""), null);
  assert.equal(returnedReference("?reference="), null);
  // Words, markup and anything longer than a reference are not one.
  for (const not of ["a b", "<b>1</b>", "x/../y", "ref?x=1", "a".repeat(121)])
    assert.equal(returnedReference("?reference=" + encodeURIComponent(not)), null, not);
});

test("the address loses what the provider added and keeps everything else", () => {
  assert.equal(
    withoutReturn("/workspace/purchases", "?trxref=valo-test-1&reference=valo-test-1"),
    "/workspace/purchases",
  );
  assert.equal(
    withoutReturn("/workspace/purchases", "offer=abc&reference=valo-test-1&trxref=valo-test-1"),
    "/workspace/purchases?offer=abc",
  );
  assert.equal(withoutReturn("/workspace/purchases", ""), "/workspace/purchases");
});

const order = (reference: string, status: string) => ({
  id: "id-" + reference,
  reference,
  status,
  title: "Synthetic " + reference,
});

test("an order that could still have been paid is asked about, a settled one is shown as it is, and a reference no listed order has is nobody's here", () => {
  const orders = [
    order("r-created", "created"),
    order("r-pending", "pending"),
    order("r-abandoned", "abandoned"),
    order("r-failed", "failed"),
    order("r-verified", "verified_success"),
    order("r-review", "needs_review"),
    order("r-reversed", "reversed"),
  ];
  for (const reference of ["r-created", "r-pending", "r-abandoned", "r-failed"])
    assert.deepEqual(
      returnStep(reference, orders),
      { kind: "ask", order: orders.find((o) => o.reference === reference) },
      reference,
    );
  for (const reference of ["r-verified", "r-review", "r-reversed"])
    assert.deepEqual(
      returnStep(reference, orders),
      { kind: "settled", order: orders.find((o) => o.reference === reference) },
      reference,
    );
  assert.deepEqual(returnStep("r-another-workspace", orders), { kind: "unknown" });
  assert.deepEqual(returnStep("r-created", []), { kind: "unknown" });
  // A reference is the whole of it: part of one finds nothing.
  assert.deepEqual(returnStep("r-", orders), { kind: "unknown" });
});

test("each status is said in words that claim only what the provider reported, and only a verified payment is called verified", () => {
  const said = (status: string) => returnWords("Synthetic agreement", status);
  assert.deepEqual(said("verified_success"), {
    title: "Test purchase verified",
    text: "Your payment for Synthetic agreement is verified. Its order is below.",
  });
  assert.deepEqual(said("abandoned"), {
    title: "Payment not completed",
    text: "Paystack reports that the payment for Synthetic agreement was not completed. To try again, save a new order below.",
  });
  assert.deepEqual(said("failed"), {
    title: "Payment failed",
    text: "Paystack reports that the payment for Synthetic agreement failed. To try again, save a new order below.",
  });
  assert.deepEqual(said("needs_review"), {
    title: "Staff reconciliation required",
    text: "The payment for Synthetic agreement needs a check by Valo's staff before anything more is done. Its order is below.",
  });
  assert.deepEqual(said("reversed"), {
    title: "Payment reversed — access suspended",
    text: "The payment for Synthetic agreement was reversed. Its order is below.",
  });
  // Not yet paid, still being taken, or a status this screen has no name for: each is told how to ask
  // again.
  const waiting =
    'Paystack has not confirmed a payment for Synthetic agreement yet. Use "Check payment status" on its order below to ask again. Asking again charges nothing.';
  assert.deepEqual(said("created"), { title: "Order saved — not paid", text: waiting });
  assert.deepEqual(said("pending"), { title: "Awaiting verified payment", text: waiting });
  assert.deepEqual(said("something-new"), { title: "Payment not confirmed yet", text: waiting });
  // The title is the order card's own name for every status the card names, so the notice and the order
  // below it read alike.
  assert.equal(Object.keys(ORDER_STATUS_LABELS).length, 7);
  for (const [status, label] of Object.entries(ORDER_STATUS_LABELS))
    assert.equal(said(status).title, label, status);
  // Nothing but a verified payment is said to be verified.
  for (const status of [
    "created",
    "pending",
    "abandoned",
    "failed",
    "needs_review",
    "reversed",
    "something-new",
  ])
    assert.doesNotMatch(JSON.stringify(said(status)), /is verified|purchase verified/i, status);
});
