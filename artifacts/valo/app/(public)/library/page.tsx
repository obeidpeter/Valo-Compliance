import type { CataloguePage, PublicCoverage } from "@workspace/api-client-react";
import { GetPublicCoverageResponse, ListPublicCatalogueResponse } from "@workspace/api-zod";
import { catalogueQuery } from "@/lib/catalogue-requests";
import { catalogueParams, libraryFilters } from "@/lib/library-filters";
import { Library } from "@/public-screens/library";
import { readForPage } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";
import { searchString } from "@/server/search-params";

export const generateMetadata = () => fixedPageMetadata("/library");

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = searchString(await searchParams);
  const query = catalogueQuery(catalogueParams(libraryFilters(new URLSearchParams(search))));
  const [catalogue, coverage] = await Promise.all([
    readForPage<CataloguePage>(`/public/catalogue?${query}`, ListPublicCatalogueResponse),
    readForPage<PublicCoverage>("/public/coverage", GetPublicCoverageResponse),
  ]);
  return (
    <Library
      initialSearch={search}
      initialCatalogue={catalogue.ok ? catalogue.data : undefined}
      initialCoverage={coverage.ok ? coverage.data : undefined}
    />
  );
}
