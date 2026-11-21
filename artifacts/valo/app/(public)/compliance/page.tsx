import type { CataloguePage } from "@workspace/api-client-react";
import { ListPublicCatalogueResponse } from "@workspace/api-zod";
import { catalogueQuery, guidanceParams } from "@/lib/catalogue-requests";
import { Compliance } from "@/public-screens/compliance";
import { readForPage } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/compliance");

export default async function CompliancePage() {
  const read = await readForPage<CataloguePage>(
    `/public/catalogue?${catalogueQuery(guidanceParams)}`,
    ListPublicCatalogueResponse,
  );
  return <Compliance initial={read.ok ? read.data : undefined} />;
}
