import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TicketInputCategory } from "@workspace/api-client-react";
import { SERVICE_CATEGORIES, SERVICE_DESCRIPTIONS, ServiceCategories } from "./service-categories";
import { CATEGORY_LABELS } from "./ticket-form";

// SRV-001: "Explain registration, tax, accounting, employment, legal, privacy and sector-approval
// assistance", accepted when "service pages are useful even when no provider is listed and do not
// imply government affiliation".
test("the services page explains each kind of help without listing a provider or speaking for an authority", () => {
  const services = Object.values(TicketInputCategory).filter((c) => c !== "support");
  assert.deepEqual(SERVICE_CATEGORIES, services, "every service topic in the API contract, in order");
  const html = renderToStaticMarkup(React.createElement(ServiceCategories));
  for (const c of SERVICE_CATEGORIES) {
    assert.ok(html.includes(`<span>${CATEGORY_LABELS[c]}</span>`), c);
    assert.ok(html.includes(`>${SERVICE_DESCRIPTIONS[c]}</p>`), c);
    assert.ok(SERVICE_DESCRIPTIONS[c].length >= 40, `${c} is explained, not just named`);
  }
  assert.equal(html.match(/No provider yet/g)?.length, services.length);
  // A description says what someone can ask about. It promises no provider, booking, fee or outcome,
  // and speaks for no government body or regulator.
  const promise =
    /\b(we|our team|valo|staff) (will|can|do|provide|offer|handle|file|submit|register|arrange)\b|\bbook(s|ed|ing)?\b|appointment|guarantee|official|government|regulator|authority|approved by|on behalf|agent|accredit|partner|\bfees?\b|\bprices?\b|\bfree\b/i;
  for (const c of SERVICE_CATEGORIES) assert.doesNotMatch(SERVICE_DESCRIPTIONS[c], promise, c);

  // The page renders the list and says nothing is booked or forwarded while no provider exists.
  const page = readFileSync(
    fileURLToPath(new URL("../../app/(public)/services/page.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(page, /<ServiceCategories \/>/);
  assert.match(page, /No professional providers are listed\s+yet, so nothing is booked or forwarded\./);
});
