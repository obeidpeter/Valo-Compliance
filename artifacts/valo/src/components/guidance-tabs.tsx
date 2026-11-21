import { PublicLink } from "./public-link";
import { GUIDANCE_PAGES, sectionTab } from "./site-chrome";

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
          className={sectionTab(page.href === current)}
        >
          {page.label}
        </PublicLink>
      ))}
    </nav>
  );
}
