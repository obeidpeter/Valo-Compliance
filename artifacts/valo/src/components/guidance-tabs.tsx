import { PublicLink } from "./public-link";
import { GUIDANCE_PAGES } from "./site-chrome";
import { cn } from "@/lib/utils";

/**
 * The tabs that join the three pages the header's Guidance link opens: the overview with the
 * official sources, the guides, and guidance by industry. Each page shows them above its heading and
 * marks itself as the current one.
 */
export function GuidanceTabs({ current }: { current: (typeof GUIDANCE_PAGES)[number]["href"] }) {
  return (
    <nav aria-label="Guidance" className="mb-8 flex flex-wrap gap-2" data-testid="nav-guidance">
      {GUIDANCE_PAGES.map((page) => (
        <PublicLink
          key={page.href}
          href={page.href}
          current={page.href === current}
          className={cn(
            "rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            page.href === current
              ? "border-foreground bg-foreground text-background"
              : "border-border hover:bg-secondary",
          )}
        >
          {page.label}
        </PublicLink>
      ))}
    </nav>
  );
}
