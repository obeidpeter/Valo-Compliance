import type { ListPublicCatalogueParams, ListPublicCatalogueType } from "@workspace/api-client-react";
import { clippedSearch } from "./page-filters";

/** The kinds of item the library lists, with each filter button's label. */
export const LIBRARY_TYPES: { v: ListPublicCatalogueType; l: string }[] = [
  { v: "all", l: "Everything" },
  { v: "template", l: "Templates" },
  { v: "guidance", l: "Guidance" },
  { v: "article", l: "Articles" },
  { v: "industry", l: "Industry pages" },
  { v: "service", l: "Service enquiries" },
];

/** Every category the public catalogue emits across reviewed, manual and directory items. */
export const LIBRARY_CATEGORIES = [
  "Finance and operations",
  "People",
  "Agreements and sales",
  "Privacy and data",
  "Business management",
  "Business templates",
  "Business guidance",
  "Regulatory guidance",
  "Practical business guides",
  "Industry guidance",
  "Industry introductions",
  "Location guidance",
  "Industry directory",
  "Service enquiries",
] as const;

export type LibraryFilters = {
  q: string;
  type: ListPublicCatalogueType;
  industry: string;
  page: number;
  category: string;
  access: "all" | "free" | "premium";
  sort: "relevance" | "name" | "recently_checked";
};

/** The library's filters from its address's query, with anything unknown read as its default. */
export function libraryFilters(sp: URLSearchParams): LibraryFilters {
  const typeRaw = sp.get("type") ?? "all";
  const pageValue = Number(sp.get("page"));
  return {
    // As the box shows it and the API reads it, so that the page never has to correct its own address.
    q: clippedSearch(sp.get("q") ?? ""),
    type: (LIBRARY_TYPES.some((t) => t.v === typeRaw) ? typeRaw : "all") as ListPublicCatalogueType,
    industry: sp.get("industry") ?? "",
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    category: sp.get("category") ?? "",
    access: (["free", "premium"].includes(sp.get("access") ?? "") ? sp.get("access") : "all") as
      "all" | "free" | "premium",
    sort: (["name", "recently_checked"].includes(sp.get("sort") ?? "") ? sp.get("sort") : "relevance") as
      "relevance" | "name" | "recently_checked",
  };
}

/** The catalogue request the filters make. */
export function catalogueParams(f: LibraryFilters): ListPublicCatalogueParams {
  return {
    type: f.type,
    page: f.page,
    ...(f.category ? { category: f.category } : {}),
    access: f.access,
    sort: f.sort,
    ...(f.q ? { q: f.q } : {}),
    ...(f.industry ? { industry: f.industry } : {}),
  };
}

/** The library's address for the filters with `next` applied: it goes back to the first page and
 * leaves out every default. */
export function libraryHref(f: LibraryFilters, next: Record<string, string | number | undefined>) {
  const merged = new URLSearchParams();
  const all = {
    q: f.q,
    type: f.type,
    industry: f.industry,
    category: f.category,
    access: f.access,
    sort: f.sort,
    page: 1,
    ...next,
  } as Record<string, string | number | undefined>;
  Object.entries(all).forEach(([k, v]) => {
    if (
      v === undefined ||
      v === "" ||
      (["type", "access"].includes(k) && v === "all") ||
      (k === "sort" && v === "relevance") ||
      (k === "page" && v === 1)
    )
      return;
    merged.set(k, String(v));
  });
  const s = merged.toString();
  return "/library" + (s ? "?" + s : "");
}

/** What each kind of item is called on a result. */
const TYPE_NAMES: Record<string, string> = {
  template: "Template",
  guidance: "Guidance",
  article: "Article",
  industry: "Industry page",
  service: "Service enquiry",
};
export const typeName = (type: string) => TYPE_NAMES[type] ?? type;

/** An industry's name as a page writes it. The list of industries has them in lower case; a page
 * starts each with a capital, and changes nothing else. */
export const industryName = (title: string) => title.charAt(0).toUpperCase() + title.slice(1);

/**
 * A catalogue item's industries in words. The catalogue gives them as short codes joined by commas,
 * or as "All industries"; a result shows the names as written, never the codes. One or two are
 * named, more are counted, and a code the list of industries does not have is left out. Null when
 * there is no name to show.
 */
export function industryLabel(industry: string, names: ReadonlyMap<string, string>): string | null {
  if (industry === "All industries") return industry;
  const found = industry
    .split(",")
    .map((code) => names.get(code.trim()))
    .filter((name): name is string => !!name)
    .map(industryName);
  if (found.length === 0) return null;
  return found.length <= 2 ? found.join(" · ") : `${found[0]} and ${found.length - 1} more`;
}
