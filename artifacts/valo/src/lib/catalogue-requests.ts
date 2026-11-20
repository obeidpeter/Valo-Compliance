import type { ListPublicCatalogueParams } from "@workspace/api-client-react";

/** The catalogue request for released guidance, which the compliance page makes on the server and
 * in the browser. */
export const guidanceParams: ListPublicCatalogueParams = { type: "guidance" };

/** The catalogue request for an industry's templates, which its page makes on the server and in the
 * browser. */
export const industryTemplatesParams = (slug: string): ListPublicCatalogueParams => ({
  type: "template",
  industry: slug,
});

/** A catalogue request as the query string the browser's API client sends for it. */
export function catalogueQuery(params: ListPublicCatalogueParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  return query.toString();
}
