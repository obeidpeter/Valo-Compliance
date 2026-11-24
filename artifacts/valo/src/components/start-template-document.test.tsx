import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

test("the page offers to answer the template's questions only for a template that has them", () => {
  const drawn = (templateId: string, title: string) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <StartTemplateDocument templateId={templateId} title={title} />
      </QueryClientProvider>,
    );
  const html = drawn("manual-x", "Employment contract");
  assert.match(html, /data-testid="button-answer-questions"[^>]*>.*Answer its questions<\/button>/);
  assert.match(html, /Valo sets the document out from your answers\./);
  assert.equal(drawn("manual-x", "Customer complaint log"), "");
});
