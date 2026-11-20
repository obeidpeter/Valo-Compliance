"use client";

import { usePathname } from "next/navigation";
import { NAV } from "@/components/site-chrome";
import { PublicLink } from "@/components/public-link";
import { cn } from "@/lib/utils";

/** The header's links, with the current section marked. */
export function PrimaryNav() {
  const path = usePathname();
  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
      {NAV.map((n) => (
        <PublicLink
          key={n.href}
          href={n.href}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-secondary",
            path.startsWith(n.href) ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
          )}
          data-testid={"link-nav-" + n.label.toLowerCase()}
        >
          {n.label}
        </PublicLink>
      ))}
    </nav>
  );
}
