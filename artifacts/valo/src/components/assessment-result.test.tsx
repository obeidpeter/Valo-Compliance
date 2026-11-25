import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import type { AssessmentItem, AssessmentResult, PublicItem } from "@workspace/api-client-react";
import { factLabel } from "@/lib/checker";
import { resultGaps, resultNotice } from "@/lib/result-words";
import { AssessmentResultView } from "./assessment-result";
import { resultDocumentsKey } from "./result-documents";

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

// EDP-008: each result says how its rule was released, as the server recorded it with the result.
// A result saved before the notice was recorded shows none, and the page invents none.
test("a result shows how its rule was released, and an older saved result shows no notice", () => {
  const notice = "Synthetic release notice; not reviewed by a Nigerian legal, tax or sector specialist";
  const page = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      React.createElement(AssessmentResultView, {
        result: {
          ...result,
          items: [
            item("SYN-SIGNED", "Likely relevant", { releaseNotice: notice }),
            item("SYN-OLDER", "Likely relevant", {}),
          ],
        },
      }),
    ),
  );
  assert.ok(page.includes(`data-testid="release-notice-SYN-SIGNED">${notice}</p>`));
  // The notice sits with the rule's name, above why it is shown.
  assert.ok(page.indexOf("release-notice-SYN-SIGNED") < page.indexOf('data-testid="why-SYN-SIGNED"'));
  assert.ok(!page.includes("release-notice-SYN-OLDER"));
});

/** A synthetic released template, as the released list gives it. */
const released = (number: string, title: string, access: "free" | "premium"): PublicItem => ({
  id: `synthetic-${number}`,
  slug: `synthetic-${number.toLowerCase()}`,
  title,
  type: "template",
  summary: `Synthetic test fixture: what the ${title.toLowerCase()} is for.`,
  industry: "All industries",
  templateId: `synthetic-${number}`,
  templateNumber: number,
  access,
});
// The documents link to the library, so the page is drawn on the checker's own address.
const renderWith = (client: QueryClient, shown: AssessmentResult) =>
  renderToStaticMarkup(
    <Router ssrPath="/checker">
      <QueryClientProvider client={client}>
        <AssessmentResultView result={shown} />
      </QueryClientProvider>
    </Router>,
  );
const relating: AssessmentResult = {
  ...result,
  items: [
    item("SYN-PRIVACY", "Likely relevant", { relatedTemplateIds: ["TPL-29", "TPL-30"] }),
    item("SYN-INVOICE", "May apply", { relatedTemplateIds: ["TPL-01"] }),
    item("SYN-NONE", "Likely relevant", {}),
  ],
  // The engine recommends the documents of the likely relevant requirements alone.
  recommendedTemplateIds: ["TPL-29", "TPL-30"],
};

// RUL-006 (docs/architecture/results.md): a requirement lists the released documents its rule relates,
// and the likely relevant requirements' documents are listed together. A related document that is not
// released is never named, and a result that relates none shows neither list.
test("each requirement lists the released documents its rule relates, the likely relevant ones are listed together as recommended documents, and a document that is not released is not named", () => {
  const client = new QueryClient();
  // The released list has the privacy notice and the invoice. TPL-30 is held, so it is not in the list.
  const notice = released("TPL-29", "Synthetic privacy notice", "premium");
  const invoice = released("TPL-01", "Synthetic invoice", "free");
  client.setQueryData(resultDocumentsKey("TPL-01,TPL-29,TPL-30"), [notice, invoice]);
  const page = renderWith(client, relating);
  const block = (ruleId: string) => {
    const start = page.indexOf(`data-testid="documents-${ruleId}"`);
    return start < 0 ? "" : page.slice(start, page.indexOf("</ul>", start));
  };
  assert.match(block("SYN-PRIVACY"), /<p class="font-medium">Documents for this requirement<\/p>/);
  assert.match(
    block("SYN-PRIVACY"),
    /<a [^>]*href="\/library\/synthetic-tpl-29"[^>]*>Synthetic privacy notice<\/a><span class="text-muted-foreground"> · Premium<\/span>/,
  );
  assert.match(
    block("SYN-INVOICE"),
    /<a [^>]*href="\/library\/synthetic-tpl-01"[^>]*>Synthetic invoice<\/a><\/li>/,
  );
  assert.equal(block("SYN-NONE"), "");
  // The documents sit after the requirement's next step, inside its card.
  assert.ok(
    page.indexOf("Next step: </span>Synthetic next step for SYN-PRIVACY") <
      page.indexOf("documents-SYN-PRIVACY"),
  );
  assert.ok(page.indexOf("documents-SYN-PRIVACY") < page.indexOf("button-sources-SYN-PRIVACY"));

  // The likely relevant requirements' released documents are listed together, after the requirements and
  // before the official sources, with what they are for; the invoice's requirement only may apply.
  const start = page.indexOf('data-testid="section-recommended-documents"');
  assert.ok(start > page.indexOf('data-testid="card-item-SYN-NONE"'));
  assert.ok(start < page.indexOf("Official sources"));
  const section = page.slice(start, page.indexOf("</section>", start));
  assert.match(section, /<h3 id="recommended-documents-heading"[^>]*>Recommended documents<\/h3>/);
  assert.ok(
    section.includes(
      "These are the documents for the requirements above that are likely relevant. Using one does not by itself meet a requirement.",
    ),
  );
  assert.match(section, /href="\/library\/synthetic-tpl-29"/);
  assert.ok(section.includes("Synthetic test fixture: what the synthetic privacy notice is for."));
  assert.ok(!section.includes("Synthetic invoice"));
  // No held document is named anywhere, and a result that relates no document shows neither list.
  assert.ok(!page.includes("TPL-30"));
  assert.ok(!html.includes("Documents for this requirement"));
  assert.ok(!html.includes("Recommended documents"));
  assert.ok(!html.includes("status-result-documents-error"));
});

test("when the related documents cannot be loaded, the result says its requirements are not affected and offers to try again, in place of the recommended documents", () => {
  // A page drawn on the server shows a failed load as loading again, since a browser retries it on
  // opening; here it stays failed, as it does when that retry fails too. The browser check runs it.
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  const query = client
    .getQueryCache()
    .build(client, { queryKey: resultDocumentsKey("TPL-01,TPL-29,TPL-30") });
  query.setState({
    ...query.state,
    status: "error",
    error: new Error("Synthetic failure"),
    errorUpdateCount: 1,
  });
  const page = renderWith(client, relating);
  const start = page.indexOf('data-testid="status-result-documents-error"');
  assert.ok(start >= 0, page);
  const status = page.slice(page.lastIndexOf("<div", start), page.indexOf("</div>", start));
  assert.match(status, /role="status"/);
  assert.ok(
    status.includes(
      "The documents for these requirements could not be loaded. Your results above are not affected.",
    ),
  );
  assert.match(page, /data-testid="button-retry-result-documents">Try again<\/button>/);
  assert.ok(!page.includes("Recommended documents"));
  assert.ok(!page.includes("Documents for this requirement"));
  // The requirements themselves are all still shown.
  for (const ruleId of ["SYN-PRIVACY", "SYN-INVOICE", "SYN-NONE"])
    assert.ok(page.includes(`data-testid="card-item-${ruleId}"`), ruleId);
});

// docs/architecture/results.md, slice 2. CMP-006: a figure is shown only from its rule's source, and
// "Confirm with the authority" otherwise. CMP-007: each requirement names its authority's official page.
test("a requirement links its authority's official page, shows each figure its rule records with the passage it rests on, and says 'Confirm with the authority' for the rest; one these answers do not indicate shows neither", () => {
  const route = { authority: "Synthetic registry", url: "https://example.test/registry" };
  const fee = { kind: "fee" as const, words: "Synthetic fee words.", sourceId: "synthetic-source" };
  const page = renderWith(new QueryClient(), {
    ...result,
    items: [
      item("SYN-ROUTED", "Likely relevant", { officialRoute: route, figures: [fee] }),
      item("SYN-PLAIN", "May apply", {}),
      item("SYN-NOT", "Not indicated by these answers", { officialRoute: route, figures: [fee] }),
    ],
    officialRoutes: [{ title: route.authority, url: route.url }],
  });
  const part = (testId: string) => {
    const start = page.indexOf(`data-testid="${testId}"`);
    return start < 0 ? "" : page.slice(start, page.indexOf("</ul>", start) + 5);
  };
  assert.match(
    page,
    /data-testid="route-SYN-ROUTED"><span class="text-muted-foreground">Official page: <\/span><a href="https:\/\/example\.test\/registry" target="_blank" rel="noreferrer noopener"[^>]*>Synthetic registry<svg/,
  );
  assert.ok(
    part("figures-SYN-ROUTED").includes(
      '<li><span class="text-muted-foreground">Government fee: </span>Synthetic fee words.<span class="text-muted-foreground"> (Synthetic source, section 1)</span></li><li><span class="text-muted-foreground">Deadlines: </span>Confirm with the authority.</li>',
    ),
    part("figures-SYN-ROUTED"),
  );
  // A rule that records neither: no place to act, and both to confirm with the authority.
  assert.ok(!page.includes('data-testid="route-SYN-PLAIN"'));
  assert.ok(
    part("figures-SYN-PLAIN").includes(
      '<li><span class="text-muted-foreground">Fees and deadlines: </span>Confirm with the authority.</li>',
    ),
  );
  // Not indicated by these answers: neither a place to act nor a figure.
  assert.ok(!page.includes('data-testid="route-SYN-NOT"'));
  assert.ok(!page.includes('data-testid="figures-SYN-NOT"'));
  // The result's official sources are the routes it was given.
  assert.match(page, /<p class="eyebrow">Official sources<\/p>.*>Synthetic registry<svg/);
});
