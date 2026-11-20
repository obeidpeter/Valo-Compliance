import type { ReactNode } from "react";
import { AccountLinks } from "@/islands/account";
import { MobileDock } from "@/islands/dock";
import { IdentityLoader } from "@/islands/identity";
import { HeaderWithMenu } from "@/islands/menu";
import { PrimaryNav } from "@/islands/primary-nav";
import { PublicLink } from "./public-link";
import { DevBanner, NAV, SiteFooter } from "./site-chrome";
import { WORDMARK_LINK_CLASS, WordmarkMark } from "./wordmark";

function HomeLink() {
  return (
    <PublicLink href="/" className={WORDMARK_LINK_CLASS} data-testid="link-home">
      <WordmarkMark />
    </PublicLink>
  );
}

/**
 * The frame of every server-rendered public page (decision 0011): the same banner, header, footer and
 * dock as the browser app's shell. The server renders all of it. Islands add what needs the browser:
 * the menu button, the current section in the header, and the account links and dock, which change
 * for a signed-in visitor only once the identity provider has loaded after the page.
 */
export function PublicShell({ nonce, children }: { nonce?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <DevBanner />
      <HeaderWithMenu
        row={
          <>
            <HomeLink />
            <PrimaryNav />
            <div className="hidden items-center gap-2 lg:flex">
              <AccountLinks place="header" />
            </div>
          </>
        }
        menu={
          <>
            <nav className="grid gap-1" aria-label="Mobile">
              {NAV.map((n) => (
                <PublicLink
                  key={n.href}
                  href={n.href}
                  className="rounded-xl px-3 py-3 text-base hover:bg-secondary"
                >
                  {n.label}
                </PublicLink>
              ))}
            </nav>
            <div className="mt-4 flex flex-wrap gap-2">
              <AccountLinks place="menu" />
            </div>
          </>
        }
      />
      <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      <SiteFooter LinkTo={PublicLink} wordmark={<HomeLink />} />
      <MobileDock />
      <IdentityLoader nonce={nonce} />
    </div>
  );
}
