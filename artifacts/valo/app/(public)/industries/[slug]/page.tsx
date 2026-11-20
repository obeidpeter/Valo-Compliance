import type { CataloguePage, PublicCoverage, ReleasedResource } from "@workspace/api-client-react";
import {
  GetPublicCoverageResponse,
  ListPublicCatalogueResponse,
  ListReleasedResourcesResponse,
} from "@workspace/api-zod";
import { catalogueQuery, industryTemplatesParams } from "@/lib/catalogue-requests";
import { IndustryDetail } from "@/public-screens/industries";
import { readForPage } from "@/server/page-api";
import { detailPageMetadata } from "@/server/page-metadata";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  return detailPageMetadata(`/industries/${encodeURIComponent((await params).slug)}`);
}

export default async function IndustryPage({ params }: Params) {
  const { slug } = await params;
  const [coverage, resources, templates] = await Promise.all([
    readForPage<PublicCoverage>("/public/coverage", GetPublicCoverageResponse),
    readForPage<ReleasedResource[]>("/public/resources", ListReleasedResourcesResponse),
    readForPage<CataloguePage>(
      `/public/catalogue?${catalogueQuery(industryTemplatesParams(slug))}`,
      ListPublicCatalogueResponse,
    ),
  ]);
  return (
    <IndustryDetail
      slug={slug}
      initial={{
        coverage: coverage.ok ? coverage.data : undefined,
        resources: resources.ok ? resources.data : undefined,
        templates: templates.ok ? templates.data : undefined,
      }}
    />
  );
}
