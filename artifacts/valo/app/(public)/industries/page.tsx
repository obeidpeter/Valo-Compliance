import type { PublicCoverage, ReleasedResource } from "@workspace/api-client-react";
import { GetPublicCoverageResponse, ListReleasedResourcesResponse } from "@workspace/api-zod";
import { Industries } from "@/public-screens/industries";
import { readForPage } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/industries");

export default async function IndustriesPage() {
  const [coverage, resources] = await Promise.all([
    readForPage<PublicCoverage>("/public/coverage", GetPublicCoverageResponse),
    readForPage<ReleasedResource[]>("/public/resources", ListReleasedResourcesResponse),
  ]);
  return (
    <Industries
      initial={{
        coverage: coverage.ok ? coverage.data : undefined,
        resources: resources.ok ? resources.data : undefined,
      }}
    />
  );
}
