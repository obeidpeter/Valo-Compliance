import * as api from "@workspace/api-zod";
import { coveragePlan } from "@workspace/valo-core";
import type { Api } from "./app-in-browser";

/**
 * Synthetic answers for the public pages, each checked against the API contract's schema, keyed by
 * method and API path: a few released templates and guidance entries, the coverage plan's
 * industries, and empty development registers for the build status page. Shared by the checks that
 * bundle the browser app and those that run the compiled web server.
 */
const plan = coveragePlan();
export const industries = plan.industries.map((industry) => ({
  id: industry.id,
  slug: industry.slug,
  title: industry.title,
  deeperPackTarget: industry.deeperPackTarget,
  enhancedEvidenceRequired: industry.enhancedEvidenceRequired,
  coverageState: industry.coverageState,
  evidenceState: industry.evidenceState,
  sourceCheckedAt: industry.sourceCheckedAt,
  publishedItems: industry.publishedItems,
}));
export const items = Array.from({ length: 6 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  templateId: `TPL-${String(i + 1).padStart(2, "0")}`,
  slug: `synthetic-template-${i + 1}`,
  title: `Synthetic business template ${i + 1}`,
  type: "template",
  industry: industries[i % industries.length]!.slug,
  category: ["Finance and operations", "People", "Sales"][i % 3]!,
  access: i % 2 ? ("premium" as const) : ("free" as const),
  summary: "Synthetic test fixture describing what this template records.",
  href: `/library/synthetic-template-${i + 1}`,
  reviewedAt: "2026-11-01T00:00:00.000Z",
}));
export const resources = Array.from({ length: 3 }, (_, i) => ({
  id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`,
  slug: `synthetic-guide-${i + 1}`,
  title: `Synthetic guidance ${i + 1}`,
  kind: "guidance" as const,
  industrySlugs: [industries[i % industries.length]!.slug],
  summary: "Synthetic test fixture summarising a guidance entry.",
  body: "Synthetic test fixture body text. ".repeat(20),
  reviewedAt: "2026-11-01T00:00:00.000Z",
  disclosure: "Synthetic test fixture; not reviewed content.",
  scope: "Synthetic test fixture scope.",
  limitations: "Synthetic test fixture limitations.",
  sources: [
    { url: "https://example.test/synthetic-source", title: "Synthetic source", locator: "Section 1" },
  ],
}));
export const industry = industries[0]!;

/** Synthetic answers, each checked against the contract's schema, keyed by method and API path. */
export const answers: Record<string, unknown> = {
  "GET /public/status": api.GetBuildStatusResponse.parse({
    receivedRequirements: 127,
    expectedRequirements: 127,
    publishedTemplates: items.length,
    p0Passed: false,
    r2Unlocked: false,
    livePaymentsEnabled: false,
    notice: "Synthetic test fixture.",
  }),
  "GET /public/coverage": api.GetPublicCoverageResponse.parse({
    industries,
    guidanceTarget: 30,
    publishedGuidance: resources.length,
    guidesTarget: plan.guidesTarget,
    publishedGuides: 0,
    deeperPackTarget: plan.deeperPackTarget,
    publishedDeeperPacks: 0,
    selectableLocations: plan.selectableLocations,
    priorityLocations: plan.priorityLocations,
    checkedLocationPacks: 0,
    notice: "Synthetic test fixture.",
    ngoNotice: "Synthetic test fixture.",
  }),
  "GET /public/catalogue": api.ListPublicCatalogueResponse.parse({
    items,
    total: items.length,
    page: 1,
    heldTemplates: 0,
  }),
  "GET /public/resources": api.ListReleasedResourcesResponse.parse(resources),
  [`GET /public/resources/${resources[0]!.slug}`]: api.GetReleasedResourceResponse.parse(resources[0]),
  [`GET /public/templates/${items[0]!.slug}`]: api.GetReleasedTemplateResponse.parse({
    id: items[0]!.id,
    templateId: items[0]!.templateId,
    slug: items[0]!.slug,
    title: items[0]!.title,
    summary: items[0]!.summary,
    version: 1,
    reviewedAt: "2026-11-01T00:00:00.000Z",
    reviewBy: "2027-05-01T00:00:00.000Z",
    disclosure: "Synthetic test fixture; not reviewed content.",
    scope: "Synthetic test fixture scope.",
    limitations: "Synthetic test fixture limitations.",
    preview: ["Synthetic preview of the template's first section."],
    developmentOnly: true,
    commercialLicenceAccepted: false,
    formats: ["docx", "pdf"],
  }),
};

// The build status page reads the development registers; empty ones are enough to draw it.
answers["GET /healthz"] = api.HealthCheckResponse.parse({ status: "ok" });
answers["GET /development/requirements"] = api.GetRequirementsRegisterResponse.parse({
  requirements: [],
  conflicts: [],
});
answers["GET /development/content"] = api.GetContentRegisterResponse.parse({
  rows: [],
  industries: [],
  deeperPacks: [],
  identifiedTemplates: 0,
  regulatoryRows: 0,
  publishedTemplates: 0,
  notice: "Synthetic test fixture.",
  overlaps: [],
  coverageLayers: [],
  expansionBoundaries: [],
  managementFiles: [],
  ngoCaution: "Synthetic test fixture.",
  provisionalTargets: "Synthetic test fixture.",
  r2Targets: { templates: 0, guided: 0, guidance: 0, deeperPacks: 0, locationsUpTo: 0 },
});
answers["GET /development/proof"] = api.GetProofRegisterResponse.parse({
  uatPackages: [],
  gates: [],
  releaseControls: [],
  suites: [],
  r1Accepted: false,
  r2Unlocked: false,
  publicLaunchEnabled: false,
});

/** Answers the browser app's API calls in the page. */
export const answer: Api = async (route, method, path) => {
  const body = answers[`${method} ${path}`];
  if (body === undefined) throw Error("no test answer");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
};
