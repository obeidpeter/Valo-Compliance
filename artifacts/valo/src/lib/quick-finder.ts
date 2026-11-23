export type QuickFinderGroup = "Actions" | "Your documents" | "Your tasks" | "Pages" | "Account";

export type QuickFinderItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  group: QuickFinderGroup;
  keywords: string;
  /** True when the route is rendered by the server on public pages rather than the browser app. */
  serverPage?: boolean;
};

export const PUBLIC_QUICK_ITEMS: readonly QuickFinderItem[] = [
  {
    id: "pub-checker",
    label: "Check your requirements",
    description: "Answer plain questions to see which sourced Nigerian rules may apply.",
    href: "/checker",
    group: "Actions",
    keywords: "requirements cac firs tin vat ndpa lagos tax regulatory",
  },
  {
    id: "pub-documents",
    label: "Browse documents and templates",
    description: "Explore published business templates and everyday document types.",
    href: "/library",
    group: "Pages",
    keywords: "invoice receipt quotation agreement employment contract templates documents",
    serverPage: true,
  },
  {
    id: "pub-guidance",
    label: "Guidance overview",
    description: "How Valo checks official sources and what is covered.",
    href: "/compliance",
    group: "Pages",
    keywords: "guidance official sources regulators coverage overview",
    serverPage: true,
  },
  {
    id: "pub-guides",
    label: "Practical guides",
    description: "Step-by-step guides for everyday business and regulatory topics.",
    href: "/resources",
    group: "Pages",
    keywords: "guides how to articles practical steps",
    serverPage: true,
  },
  {
    id: "pub-industries",
    label: "Guidance by industry",
    description: "Find guides and templates grouped by sector.",
    href: "/industries",
    group: "Pages",
    keywords: "sector retail food tech hospitality logistics manufacturing services",
    serverPage: true,
  },
  {
    id: "pub-pricing",
    label: "Pricing",
    description: "Current development status and pricing plans.",
    href: "/pricing",
    group: "Pages",
    keywords: "cost free paid plans",
    serverPage: true,
  },
  {
    id: "pub-help",
    label: "Help centre",
    description: "Common questions, support, and sign-in troubleshooting.",
    href: "/help",
    group: "Pages",
    keywords: "faq questions support contact help",
    serverPage: true,
  },
  {
    id: "pub-contact",
    label: "Contact us",
    description: "Send a question or report a problem.",
    href: "/contact",
    group: "Pages",
    keywords: "email message support inquiry",
    serverPage: true,
  },
];

export const WORKSPACE_QUICK_ITEMS: readonly QuickFinderItem[] = [
  {
    id: "ws-new-doc",
    label: "New document",
    description: "Start a guided invoice, receipt, quotation, agreement, or blank page.",
    href: "/workspace/documents/new",
    group: "Actions",
    keywords: "create invoice receipt quotation offer agreement contract blank",
  },
  {
    id: "ws-checker",
    label: "Check requirements",
    description: "Run a new requirements check or pre-fill from your business profile.",
    href: "/workspace/checker",
    group: "Actions",
    keywords: "requirements cac firs vat tax ndpa check",
  },
  {
    id: "ws-ai",
    label: "Drafting assistant",
    description: "Turn notes into a first version of an invoice, quotation, or proposal.",
    href: "/workspace/ai",
    group: "Actions",
    keywords: "ai drafting assistant proposal payment reminder",
  },
  {
    id: "ws-home",
    label: "Workspace home",
    description: "Recent documents, open tasks, ready files, and check summary.",
    href: "/workspace",
    group: "Pages",
    keywords: "dashboard overview start home",
  },
  {
    id: "ws-documents",
    label: "Your documents",
    description: "Search, filter, and download all saved documents.",
    href: "/workspace/documents",
    group: "Pages",
    keywords: "saved files pdf word invoices receipts",
  },
  {
    id: "ws-results",
    label: "Saved results",
    description: "Review and compare earlier requirements checks.",
    href: "/workspace/assessments",
    group: "Pages",
    keywords: "history compare results requirements",
  },
  {
    id: "ws-tasks",
    label: "Tasks",
    description: "Manage your personal to-do list and due dates.",
    href: "/workspace/tasks",
    group: "Pages",
    keywords: "todo checklist deadlines due dates",
  },
  {
    id: "ws-reminders",
    label: "Reminder preferences",
    description: "Choose how many days ahead reminders are scheduled.",
    href: "/workspace/reminders",
    group: "Account",
    keywords: "email notifications alerts schedule due",
  },
  {
    id: "ws-profile",
    label: "Business profile",
    description: "Update your saved business name, state, and operating details.",
    href: "/workspace/profile",
    group: "Account",
    keywords: "company name state lga employees turnover profile",
  },
  {
    id: "ws-account",
    label: "Account and appearance",
    description: "Sign-in security, password, and light/dark theme.",
    href: "/workspace/account",
    group: "Account",
    keywords: "security mfa password theme dark light appearance",
  },
  {
    id: "ws-privacy",
    label: "Privacy and data",
    description: "Download your workspace data or submit a privacy request.",
    href: "/workspace/privacy",
    group: "Account",
    keywords: "export json deletion correction gdpr ndpa data",
  },
  {
    id: "ws-support",
    label: "Support requests",
    description: "Open or follow up on a workspace support ticket.",
    href: "/workspace/support",
    group: "Account",
    keywords: "help ticket issue bug",
  },
];

/**
 * Filters and ranks Quick Jump destinations: exact/prefix label matches come first, then label
 * substrings, then description/keyword matches.
 */
export function filterQuickFinderItems(items: readonly QuickFinderItem[], query: string): QuickFinderItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...items];
  const terms = trimmed.split(/\s+/).filter(Boolean);

  const scored: { item: QuickFinderItem; score: number }[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const haystack = `${label} ${item.description.toLowerCase()} ${item.keywords.toLowerCase()} ${item.group.toLowerCase()}`;
    if (!terms.every((term) => haystack.includes(term))) continue;
    let score = 1;
    if (label === trimmed) score = 5;
    else if (label.startsWith(trimmed)) score = 4;
    else if (label.includes(trimmed)) score = 3;
    else if (item.keywords.toLowerCase().includes(trimmed)) score = 2;
    scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.item);
}
