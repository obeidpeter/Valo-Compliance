import type { ReleasedResource } from "@workspace/api-client-react";
import { ListReleasedResourcesResponse } from "@workspace/api-zod";
import { Resources } from "@/public-screens/resources";
import { readForPage } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/resources");

export default async function ResourcesPage() {
  const read = await readForPage<ReleasedResource[]>("/public/resources", ListReleasedResourcesResponse);
  return <Resources initial={read.ok ? read.data : undefined} />;
}
