import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AssessmentItem, AssessmentResult } from "@workspace/api-client-react";
import { factLabel } from "@/lib/checker";
import { resultGaps, resultNotice } from "@/lib/result-words";
import { AssessmentResultView } from "./assessment-result";

const source = {
  id: "synthetic-source",
  url: "https://example.test/synthetic-source",
  title: "Synthetic source",
  locator: "section 1",
  quote: "Synthetic quoted passage.",
  snapshotHash: "a".repeat(64),
};

const item = (
  ruleId: string,
  label: AssessmentItem["label"],
  extra: Partial<AssessmentItem>,
): AssessmentItem => ({
  ruleId,
  ruleVersion: 3,
  requirementVersionId: `${ruleId}@3`,
  title: `Synthetic rule ${ruleId}`,
  label,
  reason: `Synthetic reason for ${ruleId}.`,
  missingFacts: [],
  matchedFacts: [],
  nextStep: `Synthetic next step for ${ruleId}.`,
  jurisdiction: { level: "state", state: "Lagos" },
  sources: [source],
  relatedTemplateIds: [],
  ...extra,
});

// The excluded-sector gap is the checker's own wording (lib/valo-core/src/checker.ts). The page says
// it, and the checker's other sentences, in the site's words (lib/result-words.ts).
const excludedSectors =
  "High-impact healthcare, financial services and energy activities require activity-specific released evidence.";

const result: AssessmentResult = {
  schemaVersion: "checker-v1",
  asOfDate: "2026-11-18",
  rulesetVersion: "synthetic-ruleset",
  items: [
    item("SYN-LIKELY", "Likely relevant", { matchedFacts: ["employees", "premises"] }),
    item("SYN-UNKNOWN", "More information needed", { missingFacts: ["premises"] }),
    item("SYN-NOT", "Not indicated by these answers", { matchedFacts: ["premises"] }),
  ],
  unanswered: ["premises"],
  gaps: [
    "State/FCT and LGA coverage is not comprehensive. Confirm location-specific requirements for Lagos.",
    excludedSectors,
  ],
  recommendedTemplateIds: [],
  officialRoutes: [{ title: "Synthetic official route", url: "https://example.test/route" }],
  notice:
    "Conditional source-governed guidance, not legal certification. Unknown answers never establish exemption.",
  sourceBackedRecommendations: 1,
  resultHash: "b".repeat(64),
};

// The optional operational aids below the result load separately; with nothing loaded they draw nothing.
const html = renderToStaticMarkup(
  React.createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    React.createElement(AssessmentResultView, { result }),
  ),
);
const card = (ruleId: string) => {
  const start = html.indexOf(`data-testid="card-item-${ruleId}"`);
  assert.ok(start >= 0, ruleId);
  return html.slice(start, html.indexOf("</li>", html.indexOf(`button-sources-${ruleId}`)));
};

test("every result explains in plain words why it is shown, with its rule, version, place and sources", () => {
  for (const it of result.items) {
    const text = card(it.ruleId);
    assert.ok(
      text.includes(
        `<p class="font-medium">Why am I seeing this?</p><p class="mt-1 text-foreground/85">${it.reason}</p>`,
      ),
      text,
    );
    assert.ok(text.includes(`Rule ${it.ruleId}, version ${it.ruleVersion}`), text);
    assert.ok(text.includes("State: Lagos"), text);
    assert.ok(text.includes(`Next step: </span>${it.nextStep}`), text);
    assert.ok(text.includes("Show 1 source"), text);
    if (it.matchedFacts.length)
      assert.ok(
        text.includes(`Answers this is based on: ${it.matchedFacts.map((f) => factLabel(f)).join(", ")}`),
        text,
      );
    else assert.ok(!text.includes("Answers this is based on"), text);
  }
  // A result that needs more information names the missing answer in plain words.
  assert.ok(card("SYN-UNKNOWN").includes(`${factLabel("premises")}: </span>Not supplied`));
  // Each result sits under its own label, so the label is part of the explanation.
  for (const label of ["Likely relevant", "More information needed", "Not indicated by these answers"])
    assert.ok(html.includes(`<section aria-label="${label}">`), label);
});

test("the result page shows every coverage gap and the excluded sectors, and no score", () => {
  assert.ok(html.includes("What Valo does not cover yet"));
  // Each thing the checker says it does not cover is on the page, in the site's words.
  const said = resultGaps(result.gaps, false);
  assert.equal(said.length, result.gaps.length);
  for (const gap of said) assert.ok(html.includes(`${gap}</li>`), gap);
  assert.ok(
    html.includes(
      "Valo does not cover every state, the FCT and every local government area. Check what applies in Lagos with the authorities there.</li>",
    ),
  );
  // The excluded sectors are named.
  assert.ok(
    html.includes(
      "Healthcare, financial services and energy are covered only where a published rule is about that activity.</li>",
    ),
  );
  // The notice says it is not a legal certificate, and that a missing answer is no exemption.
  assert.ok(html.includes(resultNotice(result.notice)));
  assert.ok(html.includes("It is not a legal certificate."));
  assert.ok(html.includes("A missing or unknown answer never means that you are exempt."));
  // The checker's own wording is not printed beside them.
  for (const sent of [...result.gaps, result.notice]) assert.ok(!html.includes(sent), sent);
  assert.doesNotMatch(html, /score|\d\s*%|percent/i);
});

// CMP-007: a rule held for stale evidence "show[s] an uncertainty notice and official route".
test("the result page shows why a held rule gives no result and links each official route", () => {
  const held: AssessmentResult = {
    ...result,
    items: [],
    gaps: [...result.gaps, "SYN-HELD: Evidence is stale or not yet checked"],
    officialRoutes: [{ title: "Synthetic official route", url: "https://example.test/route" }],
    sourceBackedRecommendations: 0,
  };
  const page = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      React.createElement(AssessmentResultView, { result: held }),
    ),
  );
  assert.ok(
    page.includes(
      "Rule SYN-HELD is on hold and gives no result here: its review date has passed, or its sources have not been checked yet.</li>",
    ),
    "the held rule's reason",
  );
  assert.ok(
    page.includes("No published rule covers these answers yet."),
    "no result is presented as a finding",
  );
  assert.match(
    page,
    /<a href="https:\/\/example\.test\/route" target="_blank" rel="noreferrer noopener"[^>]*>Synthetic official route/,
  );
});

// CMP-003: "Represent federal, state/FCT and LGA requirements separately", accepted when "a
// Lagos-only entry cannot appear as a national requirement".
test("each result says in words whether it is federal, a state's or a local government's, with its rule and version", () => {
  const placed: AssessmentResult = {
    ...result,
    items: [
      item("SYN-FEDERAL", "Likely relevant", { jurisdiction: { level: "federal" } }),
      item("SYN-STATE", "Likely relevant", { jurisdiction: { level: "state", state: "Lagos" } }),
      item("SYN-FCT", "Likely relevant", { jurisdiction: { level: "state", state: "FCT" } }),
      item("SYN-LGA", "Likely relevant", { jurisdiction: { level: "lga", state: "Lagos", lga: "Ikeja" } }),
    ],
  };
  const page = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      React.createElement(AssessmentResultView, { result: placed }),
    ),
  );
  for (const [ruleId, place] of [
    ["SYN-FEDERAL", "Federal"],
    ["SYN-STATE", "State: Lagos"],
    ["SYN-FCT", "State: FCT"],
    ["SYN-LGA", "Local government: Ikeja, Lagos"],
  ])
    assert.ok(page.includes(`${place} · Rule ${ruleId}, version 3</p>`), `${ruleId}: ${place}`);
  // A state's or a local government's requirement is never marked as federal.
  assert.equal(page.split("Federal · Rule").length - 1, 1);
});
