import type { CommerceOrder } from "@workspace/api-client-react";

const ACTIVE_ORDER_STATUSES = new Set(["created", "pending"]);
const TERMINAL_REFUND_STATUSES = new Set(["processed", "rejected", "failed"]);
const TERMINAL_DISPUTE_STATUSES = new Set(["resolved", "archived", "declined"]);

type OrderPollingSnapshot = Pick<CommerceOrder, "status" | "disputeStatus"> & {
  refunds?: ReadonlyArray<{ status: string }>;
};

/** Returns true while any order, refund, or dispute is still awaiting a provider or staff update. */
export function hasActivePurchaseWork(orders: readonly OrderPollingSnapshot[] | undefined): boolean {
  if (!orders?.length) return false;
  return orders.some((order) => {
    if (ACTIVE_ORDER_STATUSES.has(order.status)) return true;
    if (order.refunds?.some((refund) => !TERMINAL_REFUND_STATUSES.has(refund.status))) return true;
    if (order.disputeStatus && !TERMINAL_DISPUTE_STATUSES.has(order.disputeStatus)) return true;
    return false;
  });
}
