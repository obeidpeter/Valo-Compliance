import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import * as api from "@workspace/api-zod";
import { coveragePlan } from "@workspace/valo-core";
import { phoneProblems, ready, settled, startApp, type Api } from "../test-support/app-in-browser";

/**
 * NFR-006: "WCAG 2.2 AA target across critical flows; keyboard, visible focus, screen-reader labels,
 * errors and reflow", checked by "Automated checks plus manual keyboard and assistive-technology
 * review".
 *
 * The public screens the primary-page checks (public-page-states.test.ts) leave out, and the page
 * titles a visitor meets moving between public pages in the app. The app is bundled with a
 * stand-in for the identity library that reports a signed-out visitor (see app-in-browser.ts), on
 * an emulated phone, with the API answered in the page by synthetic data its contract accepts. The
 * automated check is axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules. It is not a manual or
 * assistive-technology review, and it does not check the identity provider's own sign-in widgets.
 */
let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp("signed-out");
});
after(() => app.close());

const plan = coveragePlan();
const industries = plan.industries.map((industry) => ({
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
const items = Array.from({ length: 6 }, (_, i) => ({
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
const resources = Array.from({ length: 3 }, (_, i) => ({
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
const industry = industries[0]!;

/** Synthetic answers, each checked against the contract's schema, keyed by method and API path. */
const answers: Record<string, unknown> = {
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

const answer: Api = async (route, method, path) => {
  const body = answers[`${method} ${path}`];
  if (body === undefined) throw Error("no test answer");
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
};

/** The public screens the primary-page checks leave out, with the title each gives the page. */
const SCREENS: { path: string; title: string; ready?: string; minimumStops?: number }[] = [
  { path: "/", title: "Valo — Documents and business requirements" },
  { path: "/checker", title: "Business requirements checker — Valo" },
  { path: `/library/${items[0]!.slug}`, title: `${items[0]!.title} — Valo` },
  { path: `/resources/${resources[0]!.slug}`, title: `${resources[0]!.title} — Valo` },
  { path: `/industries/${industry.slug}`, title: `${industry.title} — Valo` },
  { path: "/about", title: "About Valo" },
  { path: "/contact", title: "Contact Valo" },
  { path: "/account-access", title: "Account access help — Valo" },
  // The sign-in pages draw no site shell; the provider's card holds their heading and form. Their own
  // focusable elements are the wordmark and the access help link.
  {
    path: "/sign-in",
    title: "Sign in — Valo",
    ready: '[data-testid="link-auth-access-help"]',
    minimumStops: 2,
  },
  {
    path: "/sign-up",
    title: "Open a workspace — Valo",
    ready: '[data-testid="link-auth-access-help"]',
    minimumStops: 2,
  },
];

test("on a phone, each public screen the primary-page checks leave out names itself in the page title, fits 360 and 320 pixels, moves keyboard focus only to visible outlined elements and has no automated WCAG 2.2 AA failure", async () => {
  const problems: string[] = [];
  for (const screen of SCREENS) {
    const { page, unknown, errors, close } = await app.phone(screen.path, answer);
    try {
      const shown = await (
        screen.ready
          ? page
              .locator(screen.ready)
              .first()
              .waitFor({ state: "visible", timeout: 30_000 })
              .then(() => settled(page))
          : ready(page)
      ).then(
        () => true,
        async (error: unknown) => {
          const text = (await page.evaluate("document.body.innerText")) as string;
          problems.push(
            `${screen.path}: not ready (${String(error).split("\n")[0]}); shows: ${text.slice(0, 300).replace(/\s+/g, " ")}`,
          );
          return false;
        },
      );
      if (shown) {
        const title = await page.title();
        if (title !== screen.title) problems.push(`${screen.path}: titled "${title}"`);
        problems.push(
          ...(await phoneProblems(
            page,
            screen.path,
            screen.minimumStops ? { minimumStops: screen.minimumStops } : {},
          )),
        );
      }
      problems.push(...unknown.map((call) => `${screen.path}: no test answer for ${call}`));
      problems.push(...errors.map((error) => `${screen.path}: page error ${error}`));
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

/** Each public page the footer links to, and the title it gives the page. */
const FOOTER: [string, string][] = [
  ["/library", "Document library — Valo"],
  ["/pricing", "Pricing — Valo"],
  ["/checker", "Business requirements checker — Valo"],
  ["/resources", "Business resources — Valo"],
  ["/industries", "Industry coverage — Valo"],
  ["/compliance", "Business requirements — Valo"],
  ["/services", "Service enquiries — Valo"],
  ["/about", "About Valo"],
  ["/help", "Help — Valo"],
  ["/contact", "Contact Valo"],
  ["/support", "Support — Valo"],
  ["/account-access", "Account access help — Valo"],
  ["/privacy", "Privacy — Valo"],
  ["/terms", "Terms — Valo"],
  ["/development", "Build status — Valo"],
];

test("moving between public pages in the app, from the footer and from a library card, titles each page for itself", async () => {
  const problems: string[] = [];
  const { page, unknown, errors, close } = await app.phone("/terms", answer);
  /** Follows a link with the keyboard, as a visitor using Tab and Enter would, and reads the title. */
  const follow = async (selector: string, path: string, title: string) => {
    const link = page.locator(selector).first();
    // A list's links appear once its data has loaded.
    if (
      !(await link.waitFor({ state: "attached", timeout: 10_000 }).then(
        () => true,
        () => false,
      ))
    ) {
      problems.push(`no link to ${path} (${selector})`);
      return;
    }
    await link.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(app.origin + path).catch(() => problems.push(`${selector} did not open ${path}`));
    for (let poll = 0; poll < 50 && (await page.title()) !== title; poll++) await delay(100);
    const shown = await page.title();
    if (shown !== title) problems.push(`${path}: titled "${shown}" after moving to it in the app`);
  };
  try {
    await ready(page);
    for (const [path, title] of FOOTER) await follow(`footer a[href="${path}"]`, path, title);
    // A released item's page is titled for the item, and its section again on the way back.
    await follow(`footer a[href="/library"]`, "/library", "Document library — Valo");
    await follow(`main a[href="${items[0]!.href}"]`, items[0]!.href, `${items[0]!.title} — Valo`);
    await follow(`main a[href="/library"]`, "/library", "Document library — Valo");
    problems.push(...unknown.map((call) => `no test answer for ${call}`));
    problems.push(...errors.map((error) => `page error ${error}`));
  } finally {
    await close();
  }
  assert.deepEqual(problems, []);
});
