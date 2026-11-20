"use client";

import { FileText, Scale } from "lucide-react";
import { basePath } from "@/lib/env";
import { useIdentity } from "./identity-store";

/** The phone's one-action dock: documents and compliance given equal weight. Both lead into the
 * browser app, so both are plain links. */
export function MobileDock() {
  const signedIn = useIdentity().status === "signed-in";
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-2.5 backdrop-blur lg:hidden"
      data-testid="mobile-dock"
    >
      <div className="grid grid-cols-2 gap-2">
        <a
          href={basePath + (signedIn ? "/workspace" : "/sign-up")}
          className="btn btn-primary w-full"
          data-testid="link-dock-documents"
        >
          <FileText className="h-4 w-4" /> {signedIn ? "My drafts" : "Start a draft"}
        </a>
        <a href={`${basePath}/checker`} className="btn btn-ink w-full" data-testid="link-dock-compliance">
          <Scale className="h-4 w-4" /> Check rules
        </a>
      </div>
    </div>
  );
}
