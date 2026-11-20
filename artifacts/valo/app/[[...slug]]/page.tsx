import ClientApp from "@/client-app";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { fixedPageMetadata } from "@/server/page-metadata";

/** The browser app's pages: a fixed public page the browser still renders gets its own title and
 * description; every other page, private or unknown, is described as neither. Released items' pages
 * have their own routes (decision 0011). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  return fixedPageMetadata("/" + slug.map(encodeURIComponent).join("/"));
}

export default async function Page() {
  const nonce = (await headers()).get("x-valo-nonce") ?? undefined;
  return <ClientApp nonce={nonce} />;
}
