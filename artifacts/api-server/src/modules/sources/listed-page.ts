import { createHash } from "node:crypto";
import { checkExtractedText, extractSource } from "./source-extract";
import { fetchListedPage, SourceFailure } from "./source-fetch";

/** A listed public page as it was read: its address, when it was fetched, and the words read from it. */
export type ListedPage = { url: string; fetchedAt: string; rawChecksum: string; text: string };

/**
 * Fetches one page from the caller's fixed list and reads its words with the same extractor the
 * official sources are read with. A page that is not served as a web page, or that answers with a
 * challenge in place of its content, is refused. `fetchPage` is for tests.
 */
export async function readListedPage(
  address: string,
  listed: readonly string[],
  fetchPage: typeof fetchListedPage = fetchListedPage,
): Promise<ListedPage> {
  const response = await fetchPage(address, listed);
  if (response.status !== 200) throw new SourceFailure(`SOURCE_HTTP_${response.status}`);
  if (response.mime !== "text/html" && response.mime !== "application/xhtml+xml")
    throw new SourceFailure("SOURCE_NOT_A_WEB_PAGE");
  const { text } = await extractSource(response.bytes, response.mime);
  checkExtractedText(text);
  return {
    url: address,
    fetchedAt: response.fetchedAt.toISOString(),
    rawChecksum: createHash("sha256").update(response.bytes).digest("hex"),
    text,
  };
}
