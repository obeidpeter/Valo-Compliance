import type { ReleasedResource } from "@workspace/api-client-react";
import { GetReleasedResourceResponse } from "@workspace/api-zod";
import { ResourceDetail } from "@/public-screens/resources";
import { readForPage } from "@/server/page-api";
import { detailPageMetadata } from "@/server/page-metadata";
import { segment } from "@/server/public-api";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  return detailPageMetadata(`/resources/${encodeURIComponent((await params).slug)}`);
}

export default async function ResourcePage({ params }: Params) {
  const { slug } = await params;
  const read = await readForPage<ReleasedResource>(
    `/public/resources/${segment(slug)}`,
    GetReleasedResourceResponse,
  );
  return (
    <ResourceDetail
      slug={slug}
      initial={read.ok ? read.data : read.reason === "not-found" ? "missing" : undefined}
    />
  );
}
