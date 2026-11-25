import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocumentEdition } from "@workspace/api-client-react";
import { DocumentEditionNotice, editionMark, editionNotice } from "./document-edition";

// docs/architecture/editions.md, slice 1 (DOC-007): a document says when the template edition it was
// made from was replaced or withdrawn, and that the document itself is unchanged.
const replaced: DocumentEdition = {
  documentId: "00000000-0000-4000-8000-00000000d101",
  title: "Synthetic stock register",
  version: 1,
  state: "replaced",
  since: "2026-11-25T09:00:00.000Z",
  reason: null,
  current: { version: 2, href: "/library/manual-00000000-0000-4000-8000-00000000a101" },
};
const withdrawn: DocumentEdition = {
  ...replaced,
  state: "withdrawn",
  since: "2026-11-26T09:00:00.000Z",
  reason: "A synthetic reason a customer can read",
  current: null,
};

test("a document's notice says a newer version was released, or that the template was withdrawn, and that the document is unchanged", () => {
  assert.deepEqual(editionNotice(replaced), {
    title: "A newer version of this template was released on 25 Nov 2026",
    body: "Your document is unchanged and keeps the wording of version 1.",
  });
  assert.deepEqual(editionNotice(withdrawn), {
    title: "This template was withdrawn on 26 Nov 2026",
    body: "The reason given: A synthetic reason a customer can read. Your document stays yours: you can still open, edit and download it. Check its wording before you use it.",
  });
  // Where no date or reason is recorded, the notice says only what is known.
  assert.deepEqual(editionNotice({ ...withdrawn, since: null, reason: null }), {
    title: "This template was withdrawn",
    body: "Your document stays yours: you can still open, edit and download it. Check its wording before you use it.",
  });
  assert.equal(editionMark(replaced), "Newer template version");
  assert.equal(editionMark(withdrawn), "Template withdrawn");

  const shown = renderToStaticMarkup(<DocumentEditionNotice edition={replaced} />);
  assert.match(shown, /A newer version of this template was released on 25 Nov 2026/);
  assert.match(
    shown,
    /href="\/library\/manual-00000000-0000-4000-8000-00000000a101" data-testid="link-edition-current">See version 2</,
  );
  // A withdrawn template has no version to link to.
  assert.doesNotMatch(
    renderToStaticMarkup(<DocumentEditionNotice edition={withdrawn} />),
    /link-edition-current/,
  );
  // A document whose edition is current shows nothing.
  assert.equal(renderToStaticMarkup(<DocumentEditionNotice edition={undefined} />), "");
});
