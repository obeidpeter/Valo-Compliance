import assert from "node:assert/strict";
import test from "node:test";
import { hasActivePurchaseWork } from "./purchase-state";

test("hasActivePurchaseWork is false when there are no orders or all orders are settled", () => {
  assert.equal(hasActivePurchaseWork(undefined), false);
  assert.equal(hasActivePurchaseWork([]), false);
  assert.equal(
    hasActivePurchaseWork([
      { status: "verified_success", disputeStatus: null, refunds: [{ status: "processed" }] },
      { status: "failed", disputeStatus: "resolved", refunds: [{ status: "rejected" }] },
      { status: "abandoned", disputeStatus: "archived", refunds: [{ status: "failed" }] },
      { status: "reversed", disputeStatus: "declined", refunds: [] },
    ]),
    false,
  );
});

test("hasActivePurchaseWork is true while any order, refund, or dispute is still in progress", () => {
  assert.equal(hasActivePurchaseWork([{ status: "created", disputeStatus: null }]), true);
  assert.equal(hasActivePurchaseWork([{ status: "pending", disputeStatus: null }]), true);
  assert.equal(
    hasActivePurchaseWork([
      { status: "verified_success", disputeStatus: null, refunds: [{ status: "requested" }] },
    ]),
    true,
  );
  assert.equal(
    hasActivePurchaseWork([
      { status: "verified_success", disputeStatus: null, refunds: [{ status: "processing" }] },
    ]),
    true,
  );
  assert.equal(
    hasActivePurchaseWork([{ status: "verified_success", disputeStatus: "awaiting-merchant-feedback" }]),
    true,
  );
});
