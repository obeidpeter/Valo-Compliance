import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { getListEditionNoticesQueryKey, type EditionNotice } from "@workspace/api-client-react";
import { EditionNotices, editionNoticeWords } from "./edition-notices";

// docs/architecture/editions.md, slice 3 (EDP-011, EDT-010): a workspace that bought or used a
// template's version is told when it is replaced or withdrawn, what that means for its purchase and its
// documents, and that files it already downloaded are not affected.
const replaced: EditionNotice = {
  id: "00000000-0000-4000-8000-00000000e101",
  route: "library",
  title: "Synthetic service agreement",
  version: 1,
  kind: "replaced",
  replacementVersion: 2,
  reason: null,
  held: true,
  documents: 2,
  createdAt: "2026-11-25T09:00:00.000Z",
};
const withdrawn: EditionNotice = {
  ...replaced,
  id: "00000000-0000-4000-8000-00000000e102",
  version: 2,
  kind: "withdrawn",
  replacementVersion: null,
  reason: "A synthetic reason a customer can read",
  documents: 1,
  createdAt: "2026-11-26T09:00:00.000Z",
};

test("a notice names the template, its version and what happened, says what it means for the purchase and the documents, and that downloaded files are not affected", () => {
  assert.deepEqual(editionNoticeWords(replaced), {
    title: "“Synthetic service agreement” version 1 was replaced by version 2 on 25 Nov 2026",
    lines: [
      "Your purchase carries to version 2 at no further charge. Download it from Purchases.",
      "Your 2 documents made from version 1 are unchanged.",
      "Files you already downloaded are not affected.",
    ],
  });
  assert.deepEqual(editionNoticeWords(withdrawn), {
    title: "“Synthetic service agreement” version 2 was withdrawn on 26 Nov 2026",
    lines: [
      "The reason given: A synthetic reason a customer can read.",
      "It can no longer be downloaded or used to start a document. You can take the replacement when one is released, or ask for a refund under the refund policy.",
      "Your document made from it stays yours: you can still open, edit and download it. Check its wording before you use it.",
      "Files you already downloaded are not affected.",
    ],
  });
  // A workspace that only used the version hears nothing of a purchase, and one that only holds the
  // template hears nothing of documents.
  assert.deepEqual(editionNoticeWords({ ...replaced, held: false, documents: 1 }).lines, [
    "Your document made from version 1 is unchanged.",
    "Files you already downloaded are not affected.",
  ]);
  assert.deepEqual(editionNoticeWords({ ...withdrawn, reason: null, documents: 0 }).lines, [
    "It can no longer be downloaded or used to start a document. You can take the replacement when one is released, or ask for a refund under the refund policy.",
    "Files you already downloaded are not affected.",
  ]);
  assert.deepEqual(editionNoticeWords({ ...withdrawn, held: false, documents: 3 }).lines, [
    "The reason given: A synthetic reason a customer can read.",
    "Your 3 documents made from it stay yours: you can still open, edit and download them. Check their wording before you use them.",
    "Files you already downloaded are not affected.",
  ]);
  // A replacement's notice says what changed in the new version, as its editor wrote it
  // (docs/architecture/guidance-currency.md, slice 3).
  assert.deepEqual(
    editionNoticeWords({ ...replaced, reason: "The payment clause now names the due date" }).lines,
    [
      "What changed: The payment clause now names the due date.",
      "Your purchase carries to version 2 at no further charge. Download it from Purchases.",
      "Your 2 documents made from version 1 are unchanged.",
      "Files you already downloaded are not affected.",
    ],
  );
});

test("the workspace's home lists its unread notices, each with a way to mark it read, and nothing when there are none", () => {
  const shown = (items: EditionNotice[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(getListEditionNoticesQueryKey(), { items });
    return renderToStaticMarkup(
      <Router ssrPath="/workspace">
        <QueryClientProvider client={client}>
          <EditionNotices />
        </QueryClientProvider>
      </Router>,
    );
  };
  const markup = shown([replaced, withdrawn]);
  assert.match(markup, /Changes to templates you bought or used/);
  assert.match(markup, /“Synthetic service agreement” version 1 was replaced by version 2 on 25 Nov 2026/);
  assert.match(markup, /Download it from <a[^>]*href="\/workspace\/purchases"[^>]*>Purchases<\/a>\./);
  assert.equal(markup.match(/>Mark as read</g)?.length, 2);
  assert.match(
    markup,
    /aria-label="Mark as read: “Synthetic service agreement” version 2 was withdrawn on 26 Nov 2026"/,
  );
  assert.equal(shown([]), "");
});
