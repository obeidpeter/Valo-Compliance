import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverReceiptWithEvidence, type ReceiptRecoveryResult } from "./valo-receipt-recovery-report";
const result = (repaired = false, status = "held_synthetic_recovery"): ReceiptRecoveryResult => ({
  repaired,
  receiptId: "synthetic-receipt",
  deliveryStatus: status,
  realProviderVerification: false,
});
test("reports one created held receipt and its stable retry", async () => {
  let calls = 0;
  const outcome = await recoverReceiptWithEvidence("order-a", async (id) => {
    assert.equal(id, "order-a");
    return result(++calls === 1);
  });
  assert.equal(outcome.disposition, "repaired");
  assert.equal(outcome.orderId, "order-a");
  assert.equal(calls, 3);
  assert.deepEqual(
    outcome.observations.map((r) => r.repaired),
    [true, false, false],
  );
});
test("an existing receipt retains its status and is not counted as repaired", async () => {
  const outcome = await recoverReceiptWithEvidence("order-b", async () => result(false, "sent"));
  assert.equal(outcome.disposition, "already_present");
  assert.equal(outcome.observations[2].deliveryStatus, "sent");
});
test("awaits a successful peer and retains its receipt when another call fails", async () => {
  let calls = 0,
    release: () => void = () => {};
  const peer = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = recoverReceiptWithEvidence("order-c", async () => {
    if (++calls === 1) throw Object.assign(Error("PRIVATE SQL PAYLOAD MUST NOT APPEAR"), { status: 409 });
    await peer;
    return result(true);
  });
  release();
  const outcome = await pending;
  assert.equal(calls, 2);
  assert.equal(outcome.disposition, "needs_review");
  assert.equal(outcome.observations[0].receiptId, "synthetic-receipt");
  assert.equal(outcome.failures[0].reason, "ineligible_synthetic_fixture");
  assert.ok(!JSON.stringify(outcome).includes("PRIVATE SQL"));
});
test("preserves order IDs and safe database reason codes for failed repairs", async () => {
  const outcome = await recoverReceiptWithEvidence("order-d", async () => {
    // oxlint-disable-next-line typescript/only-throw-error -- imitates a database driver error's shape
    throw { cause: { code: "23503", detail: "PRIVATE ROW" } };
  });
  assert.equal(outcome.orderId, "order-d");
  assert.equal(outcome.failures.length, 2);
  assert.equal(outcome.failures[0].databaseCode, "23503");
  assert.ok(!JSON.stringify(outcome).includes("PRIVATE ROW"));
});
test("retains precise provenance boundaries without arbitrary exception payloads", async () => {
  const outcome = await recoverReceiptWithEvidence("order-boundary", async () => {
    throw Object.assign(Error("PRIVATE DETAILS"), {
      status: 409,
      code: "SYNTHETIC_RECEIPT_INELIGIBLE",
      blockers: ["matching_grant_absent", "order_not_verified_success", "PRIVATE VALUE"],
    });
  });
  assert.equal(outcome.failures[0].boundaryCode, "SYNTHETIC_RECEIPT_INELIGIBLE");
  assert.deepEqual(outcome.failures[0].provenanceBlockers, [
    "matching_grant_absent",
    "order_not_verified_success",
  ]);
  assert.equal(outcome.failures[0].errorClass, "Error");
  assert.ok(!JSON.stringify(outcome).includes("PRIVATE"));
});
test("does not claim success for conflicting receipt IDs or unheld new receipts", async () => {
  let calls = 0;
  const different = await recoverReceiptWithEvidence("order-e", async () => ({
    ...result(++calls === 1),
    receiptId: String(calls),
  }));
  assert.equal(different.reason, "conflicting_repair_results");
  assert.equal(calls, 2);
  let unheldCalls = 0;
  const unheld = await recoverReceiptWithEvidence("order-f", async () =>
    result(++unheldCalls === 1, "awaiting_email_configuration"),
  );
  assert.equal(unheld.disposition, "needs_review");
  assert.equal(unheldCalls, 2);
});
test("records a failed repeat check without erasing the committed repair observation", async () => {
  let calls = 0;
  const outcome = await recoverReceiptWithEvidence("order-g", async () => {
    if (++calls === 3) throw Error("PRIVATE PROVIDER-LIKE ERROR");
    return result(calls === 1);
  });
  assert.equal(outcome.reason, "repeat_check_failed");
  assert.equal(outcome.observations.length, 2);
  assert.equal(outcome.observations[0].repaired, true);
  assert.equal(outcome.failures[0].attempt, 3);
  assert.ok(!JSON.stringify(outcome).includes("PRIVATE PROVIDER"));
});
