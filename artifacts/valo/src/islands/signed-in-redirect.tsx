"use client";

import { useEffect } from "react";
import { basePath } from "@/lib/env";
import { useIdentity } from "./identity-store";

/** Sends a signed-in visitor on from the home page to the workspace, once the identity provider has
 * loaded after the page (decision 0011, point 7). A signed-out visitor stays. */
export function SignedInRedirect() {
  const signedIn = useIdentity().status === "signed-in";
  useEffect(() => {
    if (signedIn) window.location.replace(`${basePath}/workspace`);
  }, [signedIn]);
  return null;
}
