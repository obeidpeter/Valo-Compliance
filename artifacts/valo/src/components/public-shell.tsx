import type { ReactNode } from "react";
import { AccountLinks } from "@/islands/account";
import { MobileDock } from "@/islands/dock";
import { IdentityLoader } from "@/islands/identity";
import { HeaderWithMenu } from "@/islands/menu";
import { MobileNav, PrimaryNav } from "@/islands/primary-nav";
import { PublicLink } from "./public-link";
import { DevBanner, SiteFooter } from "./site-chrome";
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
        data-testid="link-skip-main"
      >
        Skip to main content
      </a>
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
            <MobileNav />
            <div className="mt-4 flex flex-wrap gap-2">
              <AccountLinks place="menu" />
            </div>
          </>
        }
      />
      <main id="main-content" tabIndex={-1} className="flex-1 pb-24 outline-none lg:pb-0">
        {children}
      </main>
      <SiteFooter LinkTo={PublicLink} wordmark={<HomeLink />} />
      <MobileDock />
      <IdentityLoader nonce={nonce} />
    </div>
  );
}
