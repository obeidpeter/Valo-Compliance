import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Show, useClerk, useUser } from "@clerk/react";
import {
  useListDocuments,
  useListTasks,
  getListDocumentsQueryKey,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import { Building2, ClipboardCheck, FileText, House, ListTodo, LogOut, Menu, X } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BOTTOM_BAR, MenuPanel } from "@/components/menu-panel";
import { Wordmark } from "@/components/brand";
import { DevBanner, DOCK_BUTTON, NAV, SiteFooter, inSection } from "@/components/site-chrome";
import { QuickFinderDialog, QuickFinderTrigger } from "@/islands/quick-finder";
import { documentContextSubtitle } from "@/lib/document-list-helpers";
import type { QuickFinderItem } from "@/lib/quick-finder";
import {
  ACCOUNT_PAGES,
  WORKSPACE_SECTIONS,
  inWorkspace,
  onPage,
  sectionOf,
  type WorkspaceSection,
} from "@/components/workspace-sections";
import { basePath } from "@/lib/env";
import { isServerPage } from "@/lib/server-pages";
import { cn } from "@/lib/utils";
import { ANY_DOCUMENT, signUpFor } from "@/lib/start";
import { allowUnsavedExit, hasUnsavedChanges } from "@/lib/use-unsaved-navigation";

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

/** A header link, marked when it leads to the section the page is in. */
const headerLink = (current: boolean) =>
  cn(
    "rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-secondary",
    current ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
  );
/** A link in the phone's menu. */
const MENU_LINK =
  "rounded-xl px-3 py-3 text-base hover:bg-secondary aria-[current=page]:bg-secondary aria-[current=page]:font-medium";

/** The signed-in person's initial and email. */
function useAccount() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  return {
    email,
    initials: (user?.firstName?.[0] ?? email?.[0] ?? "V").toUpperCase(),
  };
}
const SIGN_OUT_HINT = "Save changes before signing out. Unsaved forms are cleared for privacy.";

/** The header's account controls: the way into the workspace from outside it, the account menu and
 * sign out. */
function UserMenu({ path, onRequestSignOut }: { path: string; onRequestSignOut: () => void }) {
  const account = useAccount();
  return (
    <div className="flex items-center gap-2">
      {!inWorkspace(path) && (
        <Link href="/workspace" className="btn btn-primary btn-sm" data-testid="link-workspace">
          Workspace
        </Link>
      )}
      {/* A new menu for each page, so moving to a page leaves it closed. */}
      <AccountMenu key={path} initials={account.initials} email={account.email} LinkTo={ShellLink} />
      <button
        type="button"
        className="btn btn-ghost btn-sm !px-2.5"
        aria-label="Sign out"
        title={SIGN_OUT_HINT}
        onClick={onRequestSignOut}
        data-testid="button-signout"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span className="hidden xl:inline">Sign out</span>
      </button>
    </div>
  );
}

/** The same in the phone's menu, where there is room to list the account's pages outright. */
function UserLinks({ path, onRequestSignOut }: { path: string; onRequestSignOut: () => void }) {
  return (
    <>
      <nav className="mt-4 grid gap-1 border-t border-border pt-4" aria-label="Account">
        {!inWorkspace(path) && (
          <ShellLink href="/workspace" className={MENU_LINK}>
            Workspace
          </ShellLink>
        )}
        {ACCOUNT_PAGES.map((page) => (
          <ShellLink key={page.href} href={page.href} current={onPage(page, path)} className={MENU_LINK}>
            {page.label}
          </ShellLink>
        ))}
      </nav>
      <button
        type="button"
        className="btn btn-ghost mt-4"
        title={SIGN_OUT_HINT}
        onClick={onRequestSignOut}
        data-testid="button-signout-menu"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
      </button>
    </>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const { signOut } = useClerk();
  useEffect(() => {
    setOpen(false);
    setConfirmSignOut(false);
    window.scrollTo(0, 0);
  }, [location]);
  function requestSignOut() {
    if (hasUnsavedChanges()) {
      setOpen(false);
      setConfirmSignOut(true);
      return;
    }
    void signOut({ redirectUrl: basePath || "/" });
  }
  function confirmDiscardAndSignOut() {
    setConfirmSignOut(false);
    allowUnsavedExit();
    void signOut({ redirectUrl: basePath || "/" });
  }
  // Inside the workspace the header lists the workspace's sections in place of the site's pages.
  const workspace = inWorkspace(location),
    here = sectionOf(location);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
        data-testid="link-skip-main"
      >
        Skip to main content
      </a>
      {confirmSignOut && (
        <ConfirmDialog
          open
          testId="dialog-confirm-signout"
          title="Sign out with unsaved changes?"
          keep="Stay and save"
          confirm="Discard changes and sign out"
          onKeep={() => setConfirmSignOut(false)}
          onConfirm={confirmDiscardAndSignOut}
        >
          <p>
            You have changes on this page that have not been saved yet. Signing out clears them for privacy.
          </p>
        </ConfirmDialog>
      )}
      <DevBanner />
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape from any control in the header closes the menu, and so does focus moving on from the header; the header takes no focus */}
      <header
        className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            setOpen(false);
            e.currentTarget.querySelector<HTMLButtonElement>('[data-testid="button-menu"]')?.focus();
          }
        }}
        // The opened menu lies over the top of the page. When keyboard focus moves on to the page,
        // the menu closes, so the control that takes the focus is not hidden under it.
        onBlur={(e) => {
          if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget))
            setOpen(false);
        }}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
          <Wordmark />
          {workspace ? (
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Workspace">
              {WORKSPACE_SECTIONS.map((section) => (
                <ShellLink
                  key={section.id}
                  href={section.href}
                  current={here?.id === section.id}
                  className={headerLink(here?.id === section.id)}
                  data-testid={"link-section-" + section.id}
                >
                  {section.label}
                </ShellLink>
              ))}
            </nav>
          ) : (
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
              {NAV.map((n) => (
                <ShellLink
                  key={n.id}
                  href={n.href}
                  current={inSection(n, location)}
                  className={headerLink(inSection(n, location))}
                  data-testid={"link-nav-" + n.id}
                >
                  {n.label}
                </ShellLink>
              ))}
            </nav>
          )}
          <div className="hidden items-center gap-2 lg:flex">
            <QuickFinderTrigger />
            {workspace && (
              <ShellLink href="/help" className={headerLink(false)} data-testid="link-workspace-help">
                Help
              </ShellLink>
            )}
            <Show when="signed-in">
              <UserMenu path={location} onRequestSignOut={requestSignOut} />
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
            {/* Inside the workspace the bottom bar has its sections, so the menu has what the wide
                header has beside them: help, the account's pages and sign out. The site's own pages
                stay in the footer, and "Documents" means one place on the screen. */}
            <nav className="grid gap-1" aria-label="Mobile">
              {workspace ? (
                <ShellLink href="/help" className={MENU_LINK}>
                  Help
                </ShellLink>
              ) : (
                NAV.map((n) => (
                  <ShellLink key={n.id} href={n.href} current={inSection(n, location)} className={MENU_LINK}>
                    {n.label}
                  </ShellLink>
                ))
              )}
            </nav>
            <Show when="signed-in">
              <UserLinks path={location} onRequestSignOut={requestSignOut} />
            </Show>
            <Show when="signed-out">
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/sign-in" className="btn btn-ghost">
                  Sign in
                </Link>
                <Link href="/sign-up" className="btn btn-primary">
                  Create account
                </Link>
              </div>
            </Show>
          </MenuPanel>
        )}
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 pb-24 outline-none lg:pb-0">
        {children}
      </main>
      <SiteFooter LinkTo={ShellLink} wordmark={<Wordmark />} />
      {workspace ? <WorkspaceBar here={here} /> : <MobileDock />}
      <WorkspaceQuickFinder />
    </div>
  );
}

/** Lazily loads the signed-in user's documents and open tasks only when Quick Jump is opened. */
function WorkspaceQuickFinder() {
  const { isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const fetchLive = open && Boolean(isSignedIn);
  const docs = useListDocuments({
    query: { enabled: fetchLive, queryKey: getListDocumentsQueryKey() },
  });
  const tasks = useListTasks({
    query: { enabled: fetchLive, queryKey: getListTasksQueryKey() },
  });
  const extraItems = useMemo<QuickFinderItem[]>(() => {
    if (!isSignedIn) return [];
    const docItems: QuickFinderItem[] = (docs.data ?? []).slice(0, 15).map((d) => {
      const subtitle = documentContextSubtitle(d);
      return {
        id: "doc-" + d.id,
        label: d.title,
        description: subtitle
          ? `${subtitle} · Version ${d.revision}`
          : `Saved document · Version ${d.revision}`,
        href: "/workspace/documents/" + d.id,
        group: "Your documents",
        keywords: `${d.title} ${subtitle} document`,
      };
    });
    const taskItems: QuickFinderItem[] = (tasks.data ?? [])
      .filter((t) => t.state !== "completed_by_user")
      .slice(0, 10)
      .map((t) => ({
        id: "task-" + t.id,
        label: t.title,
        description: t.dueDate ? `Open task · Due ${t.dueDate}` : "Open task",
        href: "/workspace/tasks",
        group: "Your tasks",
        keywords: `${t.title} ${t.notes} task`,
      }));
    return [...docItems, ...taskItems];
  }, [docs.data, isSignedIn, tasks.data]);

  return (
    <QuickFinderDialog
      mode={isSignedIn ? "workspace" : "public"}
      extraItems={extraItems}
      onOpenChange={setOpen}
      onNavigate={(href, serverPage) => {
        if (serverPage || isServerPage(href)) {
          window.location.assign(basePath + href);
        } else {
          setLocation(href);
        }
      }}
    />
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
          <Link
            href="/workspace/documents"
            className={DOCK_BUTTON + " btn-primary"}
            data-testid="link-dock-documents"
          >
            Your documents
          </Link>
        </Show>
        <Show when="signed-out">
          <Link
            href={signUpFor(ANY_DOCUMENT)}
            className={DOCK_BUTTON + " btn-primary"}
            data-testid="link-dock-documents"
          >
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

const SECTION_ICONS = {
  home: House,
  documents: FileText,
  requirements: ClipboardCheck,
  tasks: ListTodo,
  profile: Building2,
} satisfies Record<WorkspaceSection["id"], unknown>;

/** The phone's bar inside the workspace: its five sections, with the one the screen is in marked. */
function WorkspaceBar({ here }: { here: WorkspaceSection | undefined }) {
  return (
    <nav
      aria-label="Workspace"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-1 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-1 backdrop-blur lg:hidden"
      data-testid="workspace-bar"
      {...BOTTOM_BAR}
    >
      {/* The longer words get the wider columns, so every word fits at 320 pixels. */}
      <ul className="grid grid-cols-[1fr_1.2fr_1.45fr_1fr_1fr]">
        {WORKSPACE_SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          return (
            <li key={section.id}>
              <ShellLink
                href={section.href}
                current={here?.id === section.id}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 text-[0.68rem] leading-tight focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  here?.id === section.id ? "font-medium text-primary" : "text-muted-foreground",
                )}
                data-testid={"link-bar-" + section.id}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {section.short}
              </ShellLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
