import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Show, useClerk, useUser } from "@clerk/react";
import { FileText, LogOut, Menu, Scale, X } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { basePath } from "@/lib/env";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/checker", label: "Checker" },
  { href: "/library", label: "Library" },
  { href: "/resources", label: "Resources" },
  { href: "/industries", label: "Industries" },
  { href: "/compliance", label: "Compliance" },
  { href: "/about", label: "About" },
  { href: "/help", label: "Help" },
];

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
      <div
        className="border-b border-border bg-foreground px-4 py-2 text-center text-[0.78rem] text-background/85"
        data-testid="text-dev-banner"
      >
        <span className="font-mono uppercase tracking-wider text-background">Development build</span>
        <span className="mx-2 opacity-40">/</span>
        Not launched. Use synthetic test details only — no real customer or confidential data.
      </div>
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
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-secondary",
                  location.startsWith(n.href)
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground",
                )}
                data-testid={"link-nav-" + n.label.toLowerCase()}
              >
                {n.label}
              </Link>
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
                Open a workspace
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
          <div className="reveal border-t border-border bg-background px-5 pb-6 pt-3 lg:hidden">
            <nav className="grid gap-1" aria-label="Mobile">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-xl px-3 py-3 text-base hover:bg-secondary"
                >
                  {n.label}
                </Link>
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
                  Open a workspace
                </Link>
              </Show>
            </div>
          </div>
        )}
      </header>
      <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      <footer className="border-t border-border bg-sidebar">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Your business drafts and source-governed guidance, kept on separate shelves. Built for owners of
              Nigerian small businesses.
            </p>
          </div>
          <FooterCol
            title="Documents"
            links={[
              ["/library", "Library"],
              ["/workspace", "Your workspace"],
              ["/workspace/privacy", "Privacy and data"],
              ["/pricing", "Pricing"],
            ]}
          />
          <FooterCol
            title="Compliance"
            links={[
              ["/checker", "Requirements checker"],
              ["/resources", "Resources"],
              ["/industries", "Industries"],
              ["/compliance", "Official sources"],
              ["/services", "Services"],
            ]}
          />
          <FooterCol
            title="Valo"
            links={[
              ["/about", "About"],
              ["/help", "Help"],
              ["/contact", "Contact"],
              ["/account-access", "Account access"],
              ["/privacy", "Privacy policy"],
              ["/terms", "Terms"],
              ["/development", "Developer notes"],
            ]}
          />
        </div>
        <div className="mx-auto max-w-7xl border-t border-border px-5 py-5 text-xs text-muted-foreground lg:px-8">
          Valo does not provide legal, tax or accounting advice, and no regulator endorses it.
        </div>
      </footer>
      <MobileDock />
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="eyebrow mb-4">{title}</p>
      <ul className="grid gap-2.5 text-sm">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="text-foreground/80 hover:text-foreground">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mobile one-action dock — documents and compliance given equal weight. */
function MobileDock() {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-2.5 backdrop-blur lg:hidden"
      data-testid="mobile-dock"
    >
      <div className="grid grid-cols-2 gap-2">
        <Show when="signed-in">
          <Link href="/workspace" className="btn btn-primary w-full" data-testid="link-dock-documents">
            <FileText className="h-4 w-4" /> My drafts
          </Link>
        </Show>
        <Show when="signed-out">
          <Link href="/sign-up" className="btn btn-primary w-full" data-testid="link-dock-documents">
            <FileText className="h-4 w-4" /> Start a draft
          </Link>
        </Show>
        <Link href="/checker" className="btn btn-ink w-full" data-testid="link-dock-compliance">
          <Scale className="h-4 w-4" /> Check rules
        </Link>
      </div>
    </div>
  );
}
