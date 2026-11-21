/**
 * The signed-in workspace's structure: five sections, the pages inside each, and the pages about the
 * account itself, which the header's account menu lists. The header, the tabs at the top of a
 * screen and the phone's bottom bar all read this one list, so they always agree.
 */
export type WorkspacePage = {
  href: string;
  label: string;
  /** Other addresses that open this same page. */
  also?: readonly string[];
};
export type WorkspaceSection = {
  id: "home" | "documents" | "requirements" | "tasks" | "profile";
  href: string;
  label: string;
  /** The word under the section's icon on the phone's bottom bar. */
  short: string;
  /** The section's pages, when it has more than one. */
  pages: readonly WorkspacePage[];
};

export const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = [
  { id: "home", href: "/workspace", label: "Home", short: "Home", pages: [] },
  {
    id: "documents",
    href: "/workspace/documents",
    label: "Documents",
    short: "Documents",
    pages: [
      { href: "/workspace/documents", label: "Your documents" },
      { href: "/workspace/ai", label: "Drafting assistant" },
    ],
  },
  {
    id: "requirements",
    href: "/workspace/checker",
    label: "Requirements",
    short: "Requirements",
    pages: [
      { href: "/workspace/checker", label: "Check requirements" },
      { href: "/workspace/assessments", label: "Saved results" },
    ],
  },
  {
    id: "tasks",
    href: "/workspace/tasks",
    label: "Tasks",
    short: "Tasks",
    pages: [
      { href: "/workspace/tasks", label: "Tasks" },
      { href: "/workspace/reminders", label: "Reminders", also: ["/workspace/notifications"] },
    ],
  },
  { id: "profile", href: "/workspace/profile", label: "Business profile", short: "Profile", pages: [] },
];

/** The pages about the account itself. They belong to no section. */
export const ACCOUNT_PAGES: readonly WorkspacePage[] = [
  { href: "/workspace/account", label: "Sign-in and security" },
  { href: "/workspace/privacy", label: "Privacy and data" },
  { href: "/workspace/purchases", label: "Purchases" },
];

const within = (href: string, path: string) => path === href || path.startsWith(href + "/");

/** Whether the address is inside the signed-in workspace. */
export const inWorkspace = (path: string) => within("/workspace", path);

/** Whether the address is this page, or a page opened from it, such as one document's editor. */
export const onPage = (page: WorkspacePage, path: string) =>
  [page.href, ...(page.also ?? [])].some((href) => within(href, path));

/** Whether the address is one of the pages about the account. */
export const onAccountPage = (path: string) => ACCOUNT_PAGES.some((page) => onPage(page, path));

/** The section a workspace address belongs to, if any. Home is the workspace's own address alone. */
export function sectionOf(path: string): WorkspaceSection | undefined {
  return WORKSPACE_SECTIONS.find((section) =>
    section.id === "home"
      ? path === section.href
      : section.pages.length > 0
        ? section.pages.some((page) => onPage(page, path))
        : within(section.href, path),
  );
}
