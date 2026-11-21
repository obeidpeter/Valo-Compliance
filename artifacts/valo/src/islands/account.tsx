"use client";

import { LogOut } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import type { SiteLink } from "@/components/site-chrome";
import { ACCOUNT_PAGES } from "@/components/workspace-sections";
import { basePath } from "@/lib/env";
import { useIdentity, type Identity } from "./identity-store";

/** A link into the browser app, which every account page belongs to: a plain link that loads it in
 * full (decision 0011). */
const AppLink: SiteLink = ({ href, className, children, "data-testid": testId }) => (
  <a href={basePath + href} className={className} data-testid={testId}>
    {children}
  </a>
);
const SIGN_OUT_HINT = "Save changes before signing out. Unsaved forms are cleared for privacy.";
const MENU_LINK = "rounded-xl px-3 py-3 text-base hover:bg-secondary";

type Place = "header" | "menu";

/**
 * The account links in the header and the menu. They are the signed-out links until the identity
 * provider says otherwise. Signed in, the header has the way into the workspace, the account menu
 * and sign out; the phone's menu has room to list the account's pages outright.
 */
export function AccountLinks({ place }: { place: Place }) {
  return <AccountLinksFor identity={useIdentity()} place={place} />;
}

/** The links for one visitor, apart from the provider's hook so that a test can draw a signed-in
 * visitor's: the provider itself cannot load in a test. */
export function AccountLinksFor({ identity, place }: { identity: Identity; place: Place }) {
  const size = place === "header" ? " btn-sm" : "";
  if (identity.status === "signed-in" && place === "header")
    return (
      <div className="flex items-center gap-2">
        <AppLink href="/workspace" className="btn btn-primary btn-sm" data-testid="link-workspace">
          Workspace
        </AppLink>
        <AccountMenu initials={identity.initials} email={identity.email} LinkTo={AppLink} />
        <button
          type="button"
          className="btn btn-ghost btn-sm !px-2.5"
          aria-label="Sign out"
          title={SIGN_OUT_HINT}
          onClick={() => void identity.signOut()}
          data-testid="button-signout"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    );
  if (identity.status === "signed-in")
    return (
      <div className="w-full">
        <nav className="grid gap-1 border-t border-border pt-4" aria-label="Account">
          <AppLink href="/workspace" className={MENU_LINK}>
            Workspace
          </AppLink>
          {ACCOUNT_PAGES.map((page) => (
            <AppLink key={page.href} href={page.href} className={MENU_LINK}>
              {page.label}
            </AppLink>
          ))}
        </nav>
        <button
          type="button"
          className="btn btn-ghost mt-4"
          title={SIGN_OUT_HINT}
          onClick={() => void identity.signOut()}
          data-testid="button-signout-menu"
        >
          <LogOut className="h-4 w-4" /> Sign out
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
        Create account
      </a>
    </>
  );
}
