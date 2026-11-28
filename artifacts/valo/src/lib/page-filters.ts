/**
 * WEB-002: "search/filter URLs must be shareable." The search and filters of the guides, industries
 * and help pages as their addresses carry them. The library keeps its own in the same way, and reads
 * its search with the same function (lib/library-filters.ts).
 */

/** The longest search an address carries, which is the longest the API reads. A search box takes
 * no more. */
export const SEARCH_LENGTH = 120;

/** A search as an address carries it: without the spaces around it, and no longer than that. */
export const clippedSearch = (text: string) => text.trim().slice(0, SEARCH_LENGTH);

/** What a visitor typed to search a page, from its address. */
export const typedSearch = (sp: URLSearchParams) => clippedSearch(sp.get("q") ?? "");

/** One of a page's other filters, from its address: a short name the page itself chose from. */
export const pickedFilter = (sp: URLSearchParams, key: string) => (sp.get(key) ?? "").trim().slice(0, 80);

/**
 * A page's address with its search and filters. One that is empty is left out, so the page as it
 * first opens has its plain address, and each view has one address.
 */
export function filteredHref(path: string, filters: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const kept = key === "q" ? clippedSearch(value) : value.trim().slice(0, 80);
    if (kept) sp.set(key, kept);
  }
  const query = sp.toString();
  return query ? `${path}?${query}` : path;
}
