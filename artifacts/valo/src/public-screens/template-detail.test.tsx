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

// DOC-003, EDP-008: a staff-library template's page says what it is for, what a customer needs, its
// limits, its related guidance and how it was written and checked, as its release records them.
test("a staff-library template's page shows what it is for, what you need, its limits, related guidance and how it was written", () => {
  const render = (template: ReleasedTemplate) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <TemplateDetail slug={slug} initial={template} />
      </QueryClientProvider>,
    );
  const html = render({
    ...edition("Synthetic register"),
    access: "free",
    summary: "Keep a synthetic record.",
    purpose: "Keep a synthetic record.",
    needs: ["The first synthetic fact", "The second synthetic fact"],
    limitations: "It shows nothing about the synthetic record beyond what is entered.",
    relatedGuides: [{ title: "Synthetic guide", href: "/resources/manual-synthetic", kind: "guide" }],
    disclosure: "Drafted with AI. A Valo Content editor read this version before releasing it.",
  });
  assert.match(html, /data-testid="text-summary">Keep a synthetic record\.</);
  assert.match(html, /<li>The first synthetic fact<\/li><li>The second synthetic fact<\/li>/);
  assert.match(
    html,
    /data-testid="text-limitations">It shows nothing about the synthetic record beyond what is entered\.</,
  );
  assert.match(
    html,
    /href="[^"]*\/resources\/manual-synthetic"[^>]*>Synthetic guide<\/a> <span[^>]*>· Practical guide</,
  );
  assert.match(
    html,
    /data-testid="text-disclosure">Drafted with AI\. A Valo Content editor read this version before releasing it\. Released 1 Nov 2026\.</,
  );
  // A version released before these details existed shows the statement alone.
  const older = render({ ...edition("Synthetic older"), access: "free", limitations: "" });
  assert.equal(/text-summary|list-needs|text-limitations|list-related-guides/.test(older), false);
  assert.match(older, /data-testid="text-disclosure">/);
});
