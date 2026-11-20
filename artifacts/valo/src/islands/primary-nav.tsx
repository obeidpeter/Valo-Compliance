"use client";

import { usePathname } from "next/navigation";
import { NAV, inSection } from "@/components/site-chrome";
import { PublicLink } from "@/components/public-link";
import { cn } from "@/lib/utils";

/** The header's links, with the section the page belongs to marked as the current one. */
export function PrimaryNav() {
  const path = usePathname();
  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
      {NAV.map((n) => (
        <PublicLink
          key={n.id}
          href={n.href}
          current={inSection(n, path)}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-secondary",
            inSection(n, path) ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
          )}
          data-testid={"link-nav-" + n.id}
        >
          {n.label}
        </PublicLink>
      ))}
    </nav>
  );
}

/** The same links in the phone's menu. */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="grid gap-1" aria-label="Mobile">
      {NAV.map((n) => (
        <PublicLink
          key={n.id}
          href={n.href}
          current={inSection(n, path)}
          className="rounded-xl px-3 py-3 text-base hover:bg-secondary aria-[current=page]:bg-secondary aria-[current=page]:font-medium"
        >
          {n.label}
        </PublicLink>
      ))}
    </nav>
  );
}
