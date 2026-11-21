import { Link, useLocation } from "wouter";
import { sectionTab } from "./site-chrome";
import { ACCOUNT_PAGES, onAccountPage, onPage, sectionOf } from "./workspace-sections";

/**
 * The tabs at the top of a workspace screen: the pages of the section the screen is in, or the
 * account's pages on one of those, with the screen's own page marked. A section with a single page
 * has no tabs. The sections themselves are in the header and, on a phone, in the bottom bar.
 */
export function WorkspaceNav() {
  const [path] = useLocation();
  const pages = onAccountPage(path) ? ACCOUNT_PAGES : (sectionOf(path)?.pages ?? []);
  if (pages.length === 0) return null;
  return (
    // Named apart from the header's lists, which already use the section's and the account's names.
    <nav aria-label="In this section" className="mb-8 flex flex-wrap gap-2" data-testid="nav-section-pages">
      {pages.map((page) => (
        <Link
          key={page.href}
          href={page.href}
          aria-current={onPage(page, path) ? "page" : undefined}
          className={sectionTab(onPage(page, path))}
        >
          {page.label}
        </Link>
      ))}
    </nav>
  );
}
