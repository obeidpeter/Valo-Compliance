import type { Metadata } from "next";
import { pageTitle, UNAVAILABLE_TITLE } from "@/lib/page-titles";
import { metadataOrigin, publicPages } from "@/lib/public-metadata";
import { publicDiscovery } from "./page-api";

/** The metadata of a fixed public page: its title and description from the list the sitemap and the
 * browser app also use, and its canonical address on the configured origin. Every page stays out of
 * search engines while launch is not approved. */
export function fixedPageMetadata(path: string): Metadata {
  const page = publicPages[path];
  if (!page) return { title: UNAVAILABLE_TITLE, robots: { index: false, follow: false } };
  const origin = metadataOrigin();
  return {
    title: pageTitle(page.title),
    description: page.description,
    alternates: origin ? { canonical: origin + path } : undefined,
    // Public launch is not approved. Preserve the existing no-index boundary.
    robots: { index: false, follow: false },
  };
}

/** The metadata of a released item's page: its title and description as the API's discovery list
 * gives them, the same list the sitemap uses, or the unavailable title when the API does not list
 * the item. */
export async function detailPageMetadata(path: string): Promise<Metadata> {
  const detail = (await publicDiscovery()).find((item) => item.path === path);
  if (!detail) return { title: UNAVAILABLE_TITLE, robots: { index: false, follow: false } };
  const origin = metadataOrigin();
  return {
    title: pageTitle(detail.title),
    description: detail.description,
    alternates: origin ? { canonical: origin + path } : undefined,
    robots: { index: false, follow: false },
  };
}
