import type { ComponentType, ReactNode } from "react";

/**
 * The site's header links, footer and development banner, shared by the browser app's shell and the
 * server-rendered public pages' shell (decision 0011), so both show the same site. Each shell passes
 * the link component it navigates with.
 */
export type SiteLink = ComponentType<{
  href: string;
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
}>;

export const NAV = [
  { href: "/checker", label: "Checker" },
  { href: "/library", label: "Library" },
  { href: "/resources", label: "Resources" },
  { href: "/industries", label: "Industries" },
  { href: "/compliance", label: "Compliance" },
  { href: "/about", label: "About" },
  { href: "/help", label: "Help" },
];

export const FOOTER_COLUMNS = [
  {
    title: "Documents",
    links: [
      ["/library", "Library"],
      ["/workspace", "Your workspace"],
      ["/workspace/privacy", "Privacy and data"],
      ["/pricing", "Pricing"],
    ],
  },
  {
    title: "Compliance",
    links: [
      ["/checker", "Requirements checker"],
      ["/resources", "Resources"],
      ["/industries", "Industries"],
      ["/compliance", "Official sources"],
      ["/services", "Services"],
    ],
  },
  {
    title: "Valo",
    links: [
      ["/about", "About"],
      ["/help", "Help"],
      ["/support", "Support"],
      ["/contact", "Contact"],
      ["/account-access", "Account access"],
      ["/privacy", "Privacy policy"],
      ["/terms", "Terms"],
      ["/development", "Developer notes"],
    ],
  },
] as const;

export function DevBanner() {
  return (
    <div
      className="border-b border-border bg-foreground px-4 py-2 text-center text-[0.78rem] text-background/85"
      data-testid="text-dev-banner"
    >
      <span className="font-mono uppercase tracking-wider text-background">Development build</span>
      <span className="mx-2 opacity-40">/</span>
      Not launched. Use synthetic test details only — no real customer or confidential data.
    </div>
  );
}

export function SiteFooter({ LinkTo, wordmark }: { LinkTo: SiteLink; wordmark: ReactNode }) {
  return (
    <footer className="border-t border-border bg-sidebar">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
        <div>
          {wordmark}
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Your business drafts and source-governed guidance, kept on separate shelves. Built for owners of
            Nigerian small businesses.
          </p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <FooterCol key={column.title} LinkTo={LinkTo} {...column} />
        ))}
      </div>
      <div className="mx-auto max-w-7xl border-t border-border px-5 py-5 text-xs text-muted-foreground lg:px-8">
        Valo does not provide legal, tax or accounting advice, and no regulator endorses it.
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
  LinkTo,
}: {
  title: string;
  links: readonly (readonly [string, string])[];
  LinkTo: SiteLink;
}) {
  return (
    <div>
      <p className="eyebrow mb-4">{title}</p>
      <ul className="grid gap-2.5 text-sm">
        {links.map(([href, label]) => (
          <li key={href}>
            <LinkTo href={href} className="text-foreground/80 hover:text-foreground">
              {label}
            </LinkTo>
          </li>
        ))}
      </ul>
    </div>
  );
}
