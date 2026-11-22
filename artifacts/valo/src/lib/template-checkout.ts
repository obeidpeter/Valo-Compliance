export const templateCheckoutPath = (priceId: string) =>
  "/workspace/purchases?offer=" + encodeURIComponent(priceId);

/** Only an immutable price ID can be carried through sign-in to checkout. */
export function checkoutStartPath(start: string | null | undefined) {
  const match = /^checkout-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    start ?? "",
  );
  return match ? templateCheckoutPath(match[1]!.toLowerCase()) : undefined;
}

export function checkoutSignInPath(search: string) {
  const start = "checkout-" + new URLSearchParams(search).get("offer");
  return checkoutStartPath(start) ? "/sign-in?start=" + start : "/sign-in";
}
