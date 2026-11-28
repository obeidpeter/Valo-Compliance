/** What the purchases screen calls each status of an order. */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  created: "Order saved — not paid",
  pending: "Awaiting verified payment",
  abandoned: "Payment not completed",
  failed: "Payment failed",
  verified_success: "Test purchase verified",
  needs_review: "Staff reconciliation required",
  reversed: "Payment reversed — access suspended",
};
