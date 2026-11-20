import type { ReleasedTemplate } from "@workspace/api-client-react";
import { GetReleasedTemplateResponse } from "@workspace/api-zod";
import { TemplateDetail } from "@/public-screens/template-detail";
import { readForPage } from "@/server/page-api";
import { detailPageMetadata } from "@/server/page-metadata";
import { segment } from "@/server/public-api";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  return detailPageMetadata(`/library/${encodeURIComponent((await params).slug)}`);
}

export default async function TemplatePage({ params }: Params) {
  const { slug } = await params;
  const read = await readForPage<ReleasedTemplate>(
    `/public/templates/${segment(slug)}`,
    GetReleasedTemplateResponse,
  );
  return (
    <TemplateDetail
      slug={slug}
      initial={read.ok ? read.data : read.reason === "not-found" ? "missing" : undefined}
    />
  );
}
