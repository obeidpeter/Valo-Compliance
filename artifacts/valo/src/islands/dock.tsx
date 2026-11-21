"use client";

import { BOTTOM_BAR } from "@/components/menu-panel";
import { DOCK_BUTTON } from "@/components/site-chrome";
import { basePath } from "@/lib/env";
import { ANY_DOCUMENT, signUpFor } from "@/lib/start";
import { useIdentity } from "./identity-store";

/** The phone's bar: one button for documents and one for requirements, of equal weight (WEB-001).
 * Both lead into the browser app, so both are plain links. */
export function MobileDock() {
  const signedIn = useIdentity().status === "signed-in";
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-2.5 backdrop-blur lg:hidden"
      data-testid="mobile-dock"
      {...BOTTOM_BAR}
    >
      <div className="grid grid-cols-2 gap-2">
        <a
          href={basePath + (signedIn ? "/workspace/documents" : signUpFor(ANY_DOCUMENT))}
          className={DOCK_BUTTON + " btn-primary"}
          data-testid="link-dock-documents"
        >
          {signedIn ? "Your documents" : "Create a document"}
        </a>
        <a
          href={`${basePath}/checker`}
          className={DOCK_BUTTON + " btn-ink"}
          data-testid="link-dock-compliance"
        >
          Check requirements
        </a>
      </div>
    </div>
  );
}
