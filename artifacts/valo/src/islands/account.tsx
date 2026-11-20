"use client";

import { LogOut } from "lucide-react";
import { basePath } from "@/lib/env";
import { useIdentity } from "./identity-store";

/**
 * The account links in the header and the menu. They are the signed-out links until the identity
 * provider says otherwise. Each leads into the browser app, so each is a plain link that loads it in
 * full (decision 0011).
 */
export function AccountLinks({ place }: { place: "header" | "menu" }) {
  const identity = useIdentity();
  const size = place === "header" ? " btn-sm" : "";
  if (identity.status === "signed-in")
    return (
      <div className="flex items-center gap-2">
        <a href={`${basePath}/workspace`} className="btn btn-primary btn-sm" data-testid="link-workspace">
          Workspace
        </a>
        <span
          className="hidden h-9 w-9 place-items-center rounded-full bg-secondary text-sm font-medium sm:grid"
          title={identity.email}
        >
          {identity.initials}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm !px-2.5"
          aria-label="Sign out"
          title="Save changes before signing out. Unsaved forms are cleared for privacy."
          onClick={() => void identity.signOut()}
          data-testid="button-signout"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    );
  return (
    <>
      <a
        href={`${basePath}/sign-in`}
        className={"btn btn-ghost" + size}
        {...(place === "header" ? { "data-testid": "link-signin" } : {})}
      >
        Sign in
      </a>
      <a
        href={`${basePath}/sign-up`}
        className={"btn btn-primary" + size}
        {...(place === "header" ? { "data-testid": "link-signup" } : {})}
      >
        Open a workspace
      </a>
    </>
  );
}
