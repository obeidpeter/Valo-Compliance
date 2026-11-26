import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { setting } from "../platform/settings";
import { trustedSiteOrigin } from "../lib/valo-site-origin";
import { getClerkProxyHost } from "./clerkProxyMiddleware";

/** Reads each request's sign-in, through the identity provider's library. */
export function identityMiddleware() {
  return clerkMiddleware((req) => {
    // Accept only session tokens issued for the trusted site origin (the same origin writes require).
    const origin = trustedSiteOrigin();
    return {
      publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", setting("CLERK_PUBLISHABLE_KEY")),
      ...(origin ? { authorizedParties: [origin] } : {}),
    };
  });
}
