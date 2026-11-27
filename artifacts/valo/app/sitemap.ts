import type { MetadataRoute } from "next";
import { metadataOrigin, publicPages } from "@/lib/public-metadata";
import { publicDiscovery } from "@/server/page-api";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = metadataOrigin();
  if (!origin) return [];
  const entries = await publicDiscovery();
  return [
    ...Object.keys(publicPages).map((path) => ({ url: origin + path })),
    ...entries.map((item) => ({
      url: origin + item.path,
      ...(item.modifiedAt ? { lastModified: new Date(item.modifiedAt) } : {}),
    })),
  ];
}
