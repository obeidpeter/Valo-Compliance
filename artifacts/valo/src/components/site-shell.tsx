import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Show, useClerk, useUser } from "@clerk/react";
import { LogOut, Menu, X } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { BOTTOM_BAR, MenuPanel } from "@/components/menu-panel";
import { DevBanner, DOCK_BUTTON, NAV, SiteFooter, inSection } from "@/components/site-chrome";
import { basePath } from "@/lib/env";
import { isServerPage } from "@/lib/server-pages";
import { cn } from "@/lib/utils";

/** A link in the browser app's shell: within the app, its router; to a page the server renders, a
 * plain link that loads that page in full (decision 0011). */
function ShellLink({
  href,
  className,
  children,
  current,
  "data-testid": testId,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
  /** The link leads to the section the page belongs to. */
  current?: boolean;
  "data-testid"?: string;
}) {
  const mark = current ? ({ "aria-current": "page" } as const) : {};
  return isServerPage(href) ? (
    <a href={basePath + href} className={className} data-testid={testId} {...mark}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className} data-testid={testId} {...mark}>
      {children}
    </Link>
  );
}

function UserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const initials = (
    user?.firstName?.[0] ??
    user?.primaryEmailAddress?.emailAddress?.[0] ??
    "V"
  ).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <Link href="/workspace" className="btn btn-primary btn-sm" data-testid="link-workspace">
        Workspace
      </Link>
      <span
        className="hidden h-9 w-9 place-items-center rounded-full bg-secondary text-sm font-medium sm:grid"
        title={user?.primaryEmailAddress?.emailAddress ?? ""}
      >
        {initials}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm !px-2.5"
        aria-label="Sign out"
        title="Save changes before signing out. Unsaved forms are cleared for privacy."
        onClick={() => signOut({ redirectUrl: basePath || "/" })}
        data-testid="button-signout"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [location]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <DevBanner />
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape from any control in the header closes the menu; the header takes no focus */}
      <header
        className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            setOpen(false);
            e.currentTarget.querySelector<HTMLButtonElement>('[data-testid="button-menu"]')?.focus();
          }
        }}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {NAV.map((n) => (
              <ShellLink
                key={n.id}
                href={n.href}
                current={inSection(n, location)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-secondary",
                  inSection(n, location)
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground",
                )}
                data-testid={"link-nav-" + n.id}
              >
                {n.label}
              </ShellLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <Show when="signed-in">
              <UserMenu />
            </Show>
            <Show when="signed-out">
              <Link href="/sign-in" className="btn btn-ghost btn-sm" data-testid="link-signin">
                Sign in
              </Link>
              <Link href="/sign-up" className="btn btn-primary btn-sm" data-testid="link-signup">
                Create account
              </Link>
            </Show>
          </div>
          <button
            className="btn btn-ghost btn-sm !px-2.5 lg:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
            data-testid="button-menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <MenuPanel>
            <nav className="grid gap-1" aria-label="Mobile">
              {NAV.map((n) => (
                <ShellLink
                  key={n.id}
                  href={n.href}
                  current={inSection(n, location)}
                  className="rounded-xl px-3 py-3 text-base hover:bg-secondary aria-[current=page]:bg-secondary aria-[current=page]:font-medium"
                >
                  {n.label}
                </ShellLink>
              ))}
            </nav>
            <div className="mt-4 flex flex-wrap gap-2">
              <Show when="signed-in">
                <UserMenu />
              </Show>
              <Show when="signed-out">
                <Link href="/sign-in" className="btn btn-ghost">
                  Sign in
                </Link>
                <Link href="/sign-up" className="btn btn-primary">
                  Create account
                </Link>
              </Show>
            </div>
          </MenuPanel>
        )}
      </header>
      <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      <SiteFooter LinkTo={ShellLink} wordmark={<Wordmark />} />
      <MobileDock />
    </div>
  );
}

/** The phone's bar: one button for documents and one for requirements, of equal weight (WEB-001). */
function MobileDock() {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-2.5 backdrop-blur lg:hidden"
      data-testid="mobile-dock"
      {...BOTTOM_BAR}
    >
      <div className="grid grid-cols-2 gap-2">
        <Show when="signed-in">
          <Link href="/workspace" className={DOCK_BUTTON + " btn-primary"} data-testid="link-dock-documents">
            My documents
          </Link>
        </Show>
        <Show when="signed-out">
          <Link href="/sign-up" className={DOCK_BUTTON + " btn-primary"} data-testid="link-dock-documents">
            Create a document
          </Link>
        </Show>
        <Link href="/checker" className={DOCK_BUTTON + " btn-ink"} data-testid="link-dock-compliance">
          Check requirements
        </Link>
      </div>
    </div>
  );
}
