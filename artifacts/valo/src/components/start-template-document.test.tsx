import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getListFormTemplatesQueryKey } from "@workspace/api-client-react";
import { StartTemplateDocument, guidedTemplateFor } from "./start-template-document";

// EDT-001 and DOC-005: a template's page starts the document its questions make, for the templates
// the workspace asks questions for: by a reviewed release's template ID, or by a staff-library
// edition's registered title.
test("a template's page finds its questions by the template's ID or its registered title, and no other", () => {
  assert.equal(guidedTemplateFor("TPL-01", "Anything"), "TPL-01");
  assert.equal(guidedTemplateFor("manual-00000000-0000-4000-8000-000000000001", "Offer letter"), "TPL-17");
  assert.equal(
    guidedTemplateFor("manual-00000000-0000-4000-8000-000000000001", " service AGREEMENT "),
    "TPL-13",
  );
  // A template with no questions, or a title that only resembles one, starts nothing here.
  assert.equal(guidedTemplateFor("TPL-06", "Customer complaint log"), null);
  assert.equal(guidedTemplateFor("manual-x", "Offer letter template"), null);
});

test("the page offers to answer the template's questions only for a template that has them, and says whether the document uses the template's own wording", () => {
  /** The start, with the workspace's list of templates whose wording is released for their form. */
  const drawn = (templateId: string, title: string, released: string[] = []) => {
    const client = new QueryClient();
    client.setQueryData(getListFormTemplatesQueryKey(), {
      templates: released.map((id) => ({ templateId: id, editionVersion: 1 })),
      needsPurchase: [],
    });
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <StartTemplateDocument templateId={templateId} title={title} />
      </QueryClientProvider>,
    );
  };
  const html = drawn("manual-x", "Employment contract");
  assert.match(html, /data-testid="button-answer-questions"[^>]*>.*Answer its questions<\/button>/);
  assert.match(html, /data-testid="text-start-hint">Valo sets the document out from your answers\.</);
  // Its wording released for its form (and, for this premium template, bought): the line says so.
  // Another template's release says nothing of this one.
  assert.match(
    drawn("manual-x", "Employment contract", ["TPL-16"]),
    /data-testid="text-start-hint">The document uses this template&#x27;s own wording, filled in from your answers\.</,
  );
  assert.match(drawn("manual-x", "Employment contract", ["TPL-17"]), /Valo sets the document out/);
  assert.equal(drawn("manual-x", "Customer complaint log"), "");
});
