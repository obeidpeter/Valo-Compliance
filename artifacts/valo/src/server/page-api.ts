import { cache } from "react";
import { headers } from "next/headers";
import { GetPublicDiscoveryResponse } from "@workspace/api-zod";
import { parsePublicMetadata, type PublicMetadataItem } from "@/lib/public-metadata";
import { readPublic, type PublicRead } from "./public-api";

/**
 * Reads a public endpoint while the server renders a page, its metadata or the sitemap, passing on
 * the X-Forwarded-For header the web server received so the API's rate limits can count each
 * visitor once it trusts the web server as a proxy (decision 0011, point 4). One read per path and
 * schema in a request: a page and its metadata share it.
 */
export const readForPage = cache(
  async <T>(path: string, schema: { parse: (value: unknown) => unknown }): Promise<PublicRead<T>> =>
    readPublic<T>(path, schema, { forwardedFor: (await headers()).get("x-forwarded-for") }),
);

/** The released items and directory pages the API lists for metadata and the sitemap, with every
 * path checked again (parsePublicMetadata). Empty when the API gives no usable answer. */
export async function publicDiscovery(): Promise<PublicMetadataItem[]> {
  const read = await readForPage<unknown>("/public/discovery", GetPublicDiscoveryResponse);
  return read.ok ? parsePublicMetadata(read.data) : [];
}
