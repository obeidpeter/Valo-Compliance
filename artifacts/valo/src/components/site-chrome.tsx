import type { ComponentType, ReactNode } from "react";
import { basePath } from "@/lib/env";

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

/**
 * The header's links: what a visitor can do, in the customer's words. `under` lists the addresses a
 * link's section covers, so every page of the section marks it as the current one.
 */
export const NAV = [
  { id: "documents", href: "/library", label: "Documents", under: ["/library"] },
  { id: "checker", href: "/checker", label: "Check requirements", under: ["/checker"] },
  {
    id: "guidance",
    href: "/compliance",
    label: "Guidance",
    under: ["/compliance", "/resources", "/industries"],
  },
  { id: "pricing", href: "/pricing", label: "Pricing", under: ["/pricing"] },
  { id: "help", href: "/help", label: "Help", under: ["/help", "/contact", "/support", "/account-access"] },
] as const;

/** Whether the page at this address belongs to the section a header link opens. */
export const inSection = (section: { under: readonly string[] }, path: string) =>
  section.under.some((start) => path === start || path.startsWith(start + "/"));

/** The pages the header's Guidance link groups, with the name each has on the guidance tabs. */
export const GUIDANCE_PAGES = [
  { href: "/compliance", label: "Overview" },
  { href: "/resources", label: "Guides" },
  { href: "/industries", label: "By industry" },
] as const;

export const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      ["/library", "Documents"],
      ["/checker", "Check requirements"],
      ["/compliance", "Guidance"],
      ["/pricing", "Pricing"],
    ],
  },
  {
    title: "Help",
    links: [
      ["/help", "Help centre"],
      ["/contact", "Contact us"],
      ["/account-access", "Trouble signing in"],
    ],
  },
  {
    title: "Company",
    links: [
      ["/about", "About Valo"],
      ["/services", "Services"],
      ["/privacy", "Privacy"],
      ["/terms", "Terms"],
    ],
  },
] as const;

/** A tab that joins the pages of one section, filled on the page shown. The guidance pages and the
 * workspace's sections use the same tabs. */
export const sectionTab = (current: boolean) =>
  "rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  (current ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary");

/** A button of the phone's bar. Its words may wrap, so the two buttons fit side by side on the
 * narrowest phone. */
export const DOCK_BUTTON = "btn w-full px-2 text-center text-sm leading-tight whitespace-normal";

export function DevBanner() {
  return (
    <div
      className="border-b border-border bg-foreground px-4 py-2 text-center text-[0.78rem] text-background/85"
      data-testid="text-dev-banner"
    >
      <span className="font-mono uppercase tracking-wider text-background">Development build</span>
      <span className="mx-2 opacity-40">/</span>
      Not launched. Use synthetic test details only — no real customer or confidential data.{" "}
      <a
        href={`${basePath}/development`}
        className="whitespace-nowrap text-background underline underline-offset-2"
        data-testid="link-dev-notes"
      >
        Developer notes
      </a>
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
            Business documents and source-backed guidance for Nigerian small businesses.
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
