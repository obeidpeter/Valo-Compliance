import type { CommerceOrder } from "@workspace/api-client-react";
import { ORDER_STATUS_LABELS } from "./order-status-words";

/**
 * PAY-006 (docs/architecture/order-safety.md, slice 3). The purchases screen reads an order's reference
 * from the address it is opened with, under either of two names. The payment provider is expected to
 * send the customer back with them: that has not been seen, since no call to the provider has run.
 * Coming back is not proof of payment. The reference only finds the workspace's own order, whose
 * status the server then asks the provider for.
 */
export function returnedReference(search: string): string | null {
  const query = new URLSearchParams(search);
  const reference = query.get("reference") ?? query.get("trxref");
  return reference && /^[A-Za-z0-9._-]{1,120}$/.test(reference) ? reference : null;
}

/** The same address without what the provider added, so that opening it again asks nothing. */
export function withoutReturn(path: string, search: string): string {
  const query = new URLSearchParams(search);
  query.delete("reference");
  query.delete("trxref");
  const rest = query.toString();
  return rest ? `${path}?${rest}` : path;
}

type ReturnedOrder = Pick<CommerceOrder, "id" | "reference" | "status" | "title">;

/** What the screen does about a reference it was opened with. */
export type ReturnStep<Order extends ReturnedOrder = ReturnedOrder> =
  { kind: "unknown" } | { kind: "ask"; order: Order } | { kind: "settled"; order: Order };

const COULD_HAVE_BEEN_PAID = new Set(["created", "pending", "abandoned", "failed"]);

/**
 * An order whose payment could still have gone through is asked about. One already verified, or one
 * that waits on staff or was reversed, is shown as it is: asking would change nothing. A reference no
 * listed order has is another workspace's, or not an order's at all.
 */
export function returnStep<Order extends ReturnedOrder>(
  reference: string,
  orders: readonly Order[],
): ReturnStep<Order> {
  const order = orders.find((candidate) => candidate.reference === reference);
  if (!order) return { kind: "unknown" };
  return COULD_HAVE_BEEN_PAID.has(order.status) ? { kind: "ask", order } : { kind: "settled", order };
}

/**
 * What the screen says of an order once its status is known. The title is the order card's own name for
 * the status, so the notice and the order below it read alike.
 */
export function returnWords(title: string, status: string): { title: string; text: string } {
  return {
    title: ORDER_STATUS_LABELS[status] ?? "Payment not confirmed yet",
    text: returnText(title, status),
  };
}

function returnText(title: string, status: string): string {
  switch (status) {
    case "verified_success":
      return `Your payment for ${title} is verified. Its order is below.`;
    case "abandoned":
      return `Paystack reports that the payment for ${title} was not completed. To try again, save a new order below.`;
    case "failed":
      return `Paystack reports that the payment for ${title} failed. To try again, save a new order below.`;
    case "needs_review":
      return `The payment for ${title} needs a check by Valo's staff before anything more is done. Its order is below.`;
    case "reversed":
      return `The payment for ${title} was reversed. Its order is below.`;
    default:
      return `Paystack has not confirmed a payment for ${title} yet. Use "Check payment status" on its order below to ask again. Asking again charges nothing.`;
  }
}
