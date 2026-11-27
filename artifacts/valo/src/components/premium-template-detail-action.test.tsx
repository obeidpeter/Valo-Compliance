import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TemplateOffer } from "@workspace/api-client-react";
import { PremiumTemplateDetailAction } from "./premium-template-detail-action";

const id = "00000000-0000-4000-8000-000000000001";
const offer: TemplateOffer = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "Synthetic agreement",
  amountKobo: 150000,
  currency: "NGN",
  licenceVersion: "1.0",
  licenceText: "Synthetic terms.",
  taxTreatment: "Synthetic tax treatment.",
};
const manual = { id, publicationMethod: "manual" as const, formats: ["docx" as const] };

test("a buyer sees the protected edition download even after the sale offer closes", () => {
  for (const edition of [manual, { ...manual, offer }]) {
    const html = renderToStaticMarkup(<PremiumTemplateDetailAction edition={edition} owned />);
    assert.ok(html.includes('href="/api/workspace/manual-premium-templates/' + id + '/download"'));
    assert.ok(html.includes(">Download</a>"));
    assert.ok(!html.includes("checkout"));
  }
});

test("visitors without the edition get only its current checkout", () => {
  const markup = renderToStaticMarkup(
    <PremiumTemplateDetailAction edition={{ ...manual, offer }} owned={false} />,
  );
  assert.ok(markup.includes('href="/workspace/purchases?offer=' + offer.id + '"'));
  assert.ok(!markup.includes("download"));
  assert.equal(renderToStaticMarkup(<PremiumTemplateDetailAction edition={manual} owned={false} />), "");
});

test("buyers of a reviewed edition can download each released format", () => {
  const html = renderToStaticMarkup(
    <PremiumTemplateDetailAction edition={{ id, formats: ["docx", "pdf"], offer }} owned />,
  );
  for (const format of ["docx", "pdf"]) {
    assert.ok(html.includes('href="/api/workspace/templates/' + id + "/files/" + format + '"'));
  }
  assert.ok(!html.includes("checkout"));
});
