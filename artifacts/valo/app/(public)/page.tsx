import type { BuildStatus } from "@workspace/api-client-react";
import { GetBuildStatusResponse } from "@workspace/api-zod";
import { SignedInRedirect } from "@/islands/signed-in-redirect";
import { Home } from "@/public-screens/home";
import { readForPage } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/");

/**
 * The home page, which the server renders for everyone (decision 0011, point 7). A signed-in visitor
 * sees it for a moment, then goes on to the workspace once the identity provider has loaded. The
 * count of ready-made templates shows when the server could read it.
 */
export default async function HomePage() {
  const status = await readForPage<BuildStatus>("/public/status", GetBuildStatusResponse);
  return (
    <>
      <SignedInRedirect />
      <Home templates={status.ok ? status.data.publishedTemplates : undefined} />
    </>
  );
}
