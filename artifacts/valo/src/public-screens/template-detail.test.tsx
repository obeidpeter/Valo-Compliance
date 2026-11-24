import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReleasedTemplate } from "@workspace/api-client-react";
import { TemplateDetail } from "./template-detail";

const slug = "manual-00000000-0000-4000-8000-000000000001";
/** A premium staff-library edition as the server reads it; a staff-library edition's template ID is
 * its address. */
const edition = (title: string): ReleasedTemplate => ({
  id: "00000000-0000-4000-8000-000000000002",
  templateId: slug,
  slug,
  title,
  summary: "Synthetic test fixture.",
  version: 1,
  publicationMethod: "manual",
  reviewedAt: "2026-11-01T00:00:00.000Z",
  access: "premium",
  reviewBy: null,
  disclosure: "Synthetic test fixture; not reviewed content.",
  scope: "Business template",
  limitations: "Everyday business use.",
  preview: ["Synthetic preview."],
  developmentOnly: true,
  commercialLicenceAccepted: false,
  formats: ["docx"],
});

// DOC-005 and EDT-001: a premium template's page says what its purchase opens, before a press: its
// file, and its questions too for a template the workspace asks questions for. The server renders the
// page before it knows the visitor, who holds no purchase until the browser has checked.
test("a premium template's page says a purchase opens its questions as well as its file, for a template that has questions", () => {
  const needed = (title: string) => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <TemplateDetail slug={slug} initial={edition(title)} />
      </QueryClientProvider>,
    );
    return /data-testid="text-purchase-needed">([^<]*)</.exec(html)?.[1];
  };
  assert.equal(
    needed("Offer letter"),
    "Downloading this version, or answering its questions, requires an active purchase in your workspace.",
  );
  assert.equal(
    needed("Synthetic shareholder register"),
    "Downloading this version requires an active purchase in your workspace.",
  );
});

// DOC-004: a free staff-library template's page previews the opening of its text, and says so.
test("a free staff-library template's page says its preview is the opening of the template, all of which is in its file", () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TemplateDetail slug={slug} initial={{ ...edition("Invoice"), access: "free" }} />
    </QueryClientProvider>,
  );
  assert.match(
    html,
    /data-testid="text-preview-part">The opening of the template\. All of it is in the file you download\.</,
  );
  assert.equal(/text-purchase-needed/.test(html), false);
});
