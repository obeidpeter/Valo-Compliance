import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { refreshCommerceOrder, type CommerceOrder } from "@workspace/api-client-react";
import { Notice } from "@/components/states";
import { describeError } from "@/lib/api";
import { returnStep, returnWords, returnedReference, withoutReturn } from "@/lib/payment-return";

type Found =
  | { kind: "looking" }
  | { kind: "asking"; title: string }
  | { kind: "known"; title: string; status: string }
  | { kind: "unasked"; title: string; message: string }
  | { kind: "unknown" };

/**
 * PAY-006 (docs/architecture/order-safety.md, slice 3). Opened with an order's reference in the address,
 * as the payment provider is expected to send the customer back, the purchases screen asks the server
 * once for the status of the workspace's own order with that reference, and says what it found. The
 * reference then leaves the address, so that opening the page again asks nothing. Without a reference
 * in the address this shows nothing.
 */
export function PaymentReturn({
  orders,
  unread,
  changed,
}: {
  /** The workspace's orders once they have loaded. */
  orders: readonly CommerceOrder[] | undefined;
  /** Whether the orders could not be read. The reference stays in the address until they can. */
  unread: boolean;
  changed: () => Promise<unknown>;
}) {
  const search = useSearch();
  const [location, navigate] = useLocation();
  // Read once: the address loses the reference below, and the answer still belongs to it.
  const [reference] = useState(() => returnedReference(search));
  const [found, setFound] = useState<Found>({ kind: "looking" });
  const begun = useRef(false);
  useEffect(() => {
    if (!reference || !orders || begun.current) return;
    begun.current = true;
    navigate(withoutReturn(location, search), { replace: true });
    const step = returnStep(reference, orders);
    if (step.kind === "unknown") return setFound({ kind: "unknown" });
    const { id, title, status } = step.order;
    if (step.kind === "settled") return setFound({ kind: "known", title, status });
    setFound({ kind: "asking", title });
    void (async () => {
      try {
        const now = await refreshCommerceOrder(id, {});
        setFound({ kind: "known", title, status: now.status });
      } catch (error) {
        setFound({ kind: "unasked", title, message: describeError(error).message });
      }
      // The list below shows the same order: read it again whatever the answer was.
      await changed().catch(() => {
        // The list's own error state says so if it cannot be read.
      });
    })();
  }, [reference, orders, location, search, navigate, changed]);
  if (!reference) return null;
  const words =
    found.kind === "known"
      ? returnWords(found.title, found.status)
      : found.kind === "unknown"
        ? {
            title: "No order found for this payment",
            text: "No order listed here has the reference this page was opened with. Your orders are below.",
          }
        : found.kind === "unasked"
          ? {
              title: "Your payment could not be checked just now",
              text: `${found.message} Use "Check payment status" on the order for ${found.title} below.`,
            }
          : found.kind === "asking"
            ? { title: "Checking your payment", text: `Asking Paystack about your order for ${found.title}.` }
            : unread
              ? {
                  title: "Your payment has not been checked yet",
                  text: 'Your orders could not be read, so the order you have come back from paying for has not been looked for. Use "Try again" below.',
                }
              : {
                  title: "Checking your payment",
                  text: "Finding the order you have come back from paying for.",
                };
  return (
    <div role="status" aria-live="polite" className="mb-6" data-testid="payment-return">
      <Notice
        tone={found.kind === "known" && found.status === "verified_success" ? "forest" : "ink"}
        title={words.title}
      >
        {words.text}
      </Notice>
    </div>
  );
}
