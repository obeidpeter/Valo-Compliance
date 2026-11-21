import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@workspace/valo-core";
import { buildGuideCandidate } from "./guidance-bundle";
import { captureProviderTerms } from "./provider-terms-capture";
import {
  chatGPTPermissionRecord,
  providerPermissionSentences,
  verifiedRightsApplicability,
} from "./rights-applicability";

// Nothing is fetched: the pages are made up from the sentences the permission record looks for.
const now = new Date("2026-11-22T08:00:00Z");
const sentencesOf = (url: string) =>
  providerPermissionSentences.filter((sentence) => sentence.url === url).map((sentence) => sentence.quote);
const standIn =
  (change: (url: string, text: string) => string = (_url, text) => text) =>
  async (url: string) => ({
    url,
    fetchedAt: "2026-11-22T07:59:00.000Z",
    rawChecksum: sha256(`bytes of ${url}`),
    text: change(url, `A page of the provider's terms.\n${sentencesOf(url).join("\n")}\nMore of the page.`),
  });

test("the copy holds the five pages the permission record reads, and that record accepts it", async () => {
  const asked: string[] = [];
  const reader = standIn();
  const { snapshot, read } = await captureProviderTerms(async (url) => {
    asked.push(url);
    return reader(url);
  }, now);
  const urls = [...new Set(providerPermissionSentences.map((page) => page.url))];
  assert.equal(urls.length, 5);
  assert.deepEqual(asked, urls, "each page is asked for once");
  assert.equal(snapshot.kind, "official_provider_terms_snapshot");
  assert.equal(snapshot.retrievedAt, now.toISOString());
  assert.deepEqual(
    snapshot.pages.map((page) => [page.url, page.truncated]),
    urls.map((url) => [url, false]),
  );
  assert.deepEqual(
    read.map((page) => [page.url, page.textChecksum, page.characters]),
    snapshot.pages.map((page) => [page.url, sha256(page.text), page.text.length]),
  );

  // The record a guide's preparation makes from the copy is verified.
  const built = await buildGuideCandidate("GUD-01", 1, undefined, now);
  const applicability = chatGPTPermissionRecord(
    snapshot,
    built.provenance.sourceText,
    built.provenance.note,
    now,
    {
      path: built.provenance.path,
      notePath: "docs/content-candidates/r1-content-intake-manifest.json",
      templateId: "GUD-01",
    },
  );
  assert.equal(applicability.verified, true);
  assert.equal(applicability.record.status, "verified");
  assert.equal(applicability.record.checkedAt, now.toISOString());
  assert.equal(verifiedRightsApplicability(applicability.record, now), true);
  // The record lapses, so a copy is not good for ever: after 90 days it no longer verifies.
  assert.equal(verifiedRightsApplicability(applicability.record, new Date(+now + 91 * 86_400_000)), false);
});

test("a page that no longer holds its sentence stops the copy, and says which page", async () => {
  for (const { url, quote } of providerPermissionSentences) {
    const reworded = standIn((at, text) =>
      at === url ? text.replace(quote, "The wording has changed.") : text,
    );
    await assert.rejects(captureProviderTerms(reworded, now), (error: Error) => {
      assert.equal(error.message, `PROVIDER_TERMS_SENTENCE_MISSING:${url}`);
      return true;
    });
  }
  // A page that could not be read stops it too, with the reader's own reason.
  await assert.rejects(
    captureProviderTerms(async () => {
      throw Error("SOURCE_HTTP_403");
    }, now),
    /SOURCE_HTTP_403/,
  );
  // And a reader that answers for another address.
  await assert.rejects(
    captureProviderTerms(async (url) => ({ ...(await standIn()(url)), url: `${url}other` }), now),
    /PROVIDER_TERMS_PAGE_MISMATCH/,
  );
});
