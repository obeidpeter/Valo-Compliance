import ClientApp from "@/client-app";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageTitle, UNAVAILABLE_TITLE } from "@/lib/page-titles";
import { metadataOrigin, publicPages } from "@/lib/public-metadata";
import { publicDiscovery } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  const path = "/" + slug.map(encodeURIComponent).join("/");
  if (publicPages[path]) return fixedPageMetadata(path);
  const detail =
    slug.length === 2 && ["library", "resources", "industries"].includes(slug[0]!)
      ? (await publicDiscovery()).find((item) => item.path === path)
      : undefined;
  if (!detail) return { title: UNAVAILABLE_TITLE, robots: { index: false, follow: false } };
  const origin = metadataOrigin();
  return {
    title: pageTitle(detail.title),
    description: detail.description,
    alternates: origin ? { canonical: origin + path } : undefined,
    // Public launch is not approved. Preserve the existing no-index boundary.
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const nonce = (await headers()).get("x-valo-nonce") ?? undefined;
  return <ClientApp nonce={nonce} />;
}
