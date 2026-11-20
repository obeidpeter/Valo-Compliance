"use client";

import { useEffect } from "react";
import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { basePath } from "@/lib/env";
import { publishIdentity } from "./identity-store";

/** Tells the page's islands who the identity provider says the visitor is. */
function Publish() {
  const auth = useAuth(),
    user = useUser(),
    clerk = useClerk();
  useEffect(() => {
    if (!auth.isLoaded || !user.isLoaded) return;
    const signedIn = auth.userId && user.user && user.user.id === auth.userId ? user.user : null;
    if (!signedIn) {
      publishIdentity({ status: "signed-out" });
      return;
    }
    const email = signedIn.primaryEmailAddress?.emailAddress ?? "";
    publishIdentity({
      status: "signed-in",
      email,
      initials: (signedIn.firstName?.[0] ?? email[0] ?? "V").toUpperCase(),
      signOut: () => clerk.signOut({ redirectUrl: basePath || "/" }),
    });
  }, [auth.isLoaded, auth.userId, user.isLoaded, user.user, clerk]);
  return null;
}

/**
 * The identity provider on a server-rendered public page, loaded by IdentityLoader only once the page
 * is interactive. It renders nothing itself: the account islands read what it publishes. The key is
 * worked out from the host name here, in the browser, never on the server.
 */
export function IdentityBridge({ nonce }: { nonce?: string | undefined }) {
  const publishableKey = publishableKeyFromHost(
    window.location.hostname,
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  const proxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
  if (!publishableKey) return null;
  return (
    <ClerkProvider
      {...(nonce !== undefined ? { nonce } : {})}
      publishableKey={publishableKey}
      {...(proxyUrl !== undefined ? { proxyUrl } : {})}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
    >
      <Publish />
    </ClerkProvider>
  );
}
