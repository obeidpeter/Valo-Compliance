import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { getListWorkspaceExportsQueryKey, type LibraryExport } from "@workspace/api-client-react";
import { LibraryExports } from "./library-exports";

// DOC-005: "successful exports appear in the business library and remain linked to the template
// version used." The documents screen shows this list under the documents.
const fromTemplate: LibraryExport = {
  id: "00000000-0000-4000-8000-00000000e001",
  documentId: "00000000-0000-4000-8000-00000000d001",
  documentTitle: "Synthetic stock register",
  revisionId: "00000000-0000-4000-8000-00000000c001",
  revision: 2,
  format: "pdf",
  finished: false,
  readyAt: "2026-11-19T10:00:00.000Z",
  expiresAt: null,
  downloadUrl: "/api/v1/exports/00000000-0000-4000-8000-00000000e001/file",
  template: { versionId: "00000000-0000-4000-8000-00000000b001", templateId: "TPL-07", version: 3 },
};
const blank: LibraryExport = {
  ...fromTemplate,
  id: "00000000-0000-4000-8000-00000000e002",
  documentId: "00000000-0000-4000-8000-00000000d002",
  documentTitle: "Synthetic blank draft",
  revision: 1,
  format: "docx",
  finished: true,
  downloadUrl: "/api/v1/exports/00000000-0000-4000-8000-00000000e002/file",
  template: null,
};

/** The list as the browser first draws it, from exports already in the query cache. */
function render(files: LibraryExport[]) {
  const client = new QueryClient();
  client.setQueryData(getListWorkspaceExportsQueryKey(), files);
  return renderToStaticMarkup(
    <Router ssrPath="/workspace">
      <QueryClientProvider client={client}>
        <LibraryExports />
      </QueryClientProvider>
    </Router>,
  );
}

test("the business library lists each ready export with its revision, its download and the template version it came from", () => {
  const html = render([fromTemplate, blank]);
  const first = html.slice(html.indexOf("Synthetic stock register"), html.indexOf("Synthetic blank draft"));
  const second = html.slice(html.indexOf("Synthetic blank draft"));
  assert.ok(first.includes("PDF · version 2"), first);
  // Each file says whether it is a finished file or a marked draft (docs/architecture/finished-file.md).
  assert.ok(first.includes("Draft PDF"), first);
  assert.ok(first.includes("Made from template TPL-07, version 3"), first);
  assert.ok(first.includes(`href="${fromTemplate.downloadUrl}"`), first);
  assert.ok(html.includes(`href="/workspace/documents/${fromTemplate.documentId}"`), html);
  assert.ok(second.includes("Word · version 1"), second);
  assert.ok(second.includes("Finished Word"), second);
  assert.ok(second.includes("Not made from a template"), second);
  assert.ok(second.includes(`href="${blank.downloadUrl}"`), second);
  assert.ok(html.includes("2 ready"), html);
});

test("a document copied from a staff-library template names the template by the title it was released under", () => {
  // docs/architecture/library-entries.md, slice 3: the release's address name means nothing to a reader.
  const copied: LibraryExport = {
    ...fromTemplate,
    template: {
      versionId: "00000000-0000-4000-8000-00000000b002",
      templateId: "manual-00000000-0000-4000-8000-00000000a002",
      title: "Synthetic library copy",
      version: 1,
    },
  };
  const html = render([copied]);
  assert.ok(html.includes("Copied from the template “Synthetic library copy”, version 1"), html);
  assert.ok(!html.includes("manual-00000000"), html);
});

test("an empty business library says no export is ready yet", () => {
  const html = render([]);
  assert.ok(html.includes("No files yet."), html);
  assert.ok(!html.includes("Made from template"), html);
});
