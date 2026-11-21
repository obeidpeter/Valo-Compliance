import { sha256 } from "@workspace/valo-core";
import { readListedPage, type ListedPage } from "../sources";
import { providerPermissionSentences } from "./rights-applicability";

/**
 * A copy of the AI provider's public terms, taken now, in the form a candidate's preparation reads.
 *
 * A template's or a guide's wording rests on what these pages say about who owns the output and
 * whether it may be used commercially, so each is prepared with a copy taken within a day. This
 * fetches the five pages the permission record reads and refuses the copy if any of them no longer
 * holds the sentence that record looks for: a changed sentence means the basis has to be read
 * again by a person, not that the check should be skipped.
 *
 * It decides nothing about rights. `readPage` is for tests.
 */
export async function captureProviderTerms(
  readPage: (url: string) => Promise<ListedPage> = (url) =>
    readListedPage(
      url,
      providerPermissionSentences.map((page) => page.url),
    ),
  now = new Date(),
) {
  const urls = [...new Set(providerPermissionSentences.map((page) => page.url))];
  const pages: { url: string; text: string; truncated: false }[] = [];
  const read: {
    url: string;
    fetchedAt: string;
    rawChecksum: string;
    textChecksum: string;
    characters: number;
  }[] = [];
  for (const url of urls) {
    const page = await readPage(url);
    if (page.url !== url) throw Error("PROVIDER_TERMS_PAGE_MISMATCH");
    for (const { quote } of providerPermissionSentences.filter((sentence) => sentence.url === url))
      if (!page.text.includes(quote)) throw Error(`PROVIDER_TERMS_SENTENCE_MISSING:${url}`);
    pages.push({ url, text: page.text, truncated: false });
    read.push({
      url,
      fetchedAt: page.fetchedAt,
      rawChecksum: page.rawChecksum,
      textChecksum: sha256(page.text),
      characters: page.text.length,
    });
  }
  return {
    snapshot: { kind: "official_provider_terms_snapshot" as const, retrievedAt: now.toISOString(), pages },
    read,
  };
}
