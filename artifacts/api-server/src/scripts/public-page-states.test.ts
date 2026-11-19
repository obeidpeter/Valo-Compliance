import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, devices, type Browser, type Page, type Route } from "playwright";
import axe from "axe-core";
import {
  GetBuildStatusResponse,
  GetPublicCoverageResponse,
  ListPublicCatalogueResponse,
  ListReleasedResourcesResponse,
} from "@workspace/api-zod";
import { coveragePlan } from "@workspace/valo-core";

/**
 * WEB-002: "keyboard, empty, loading, error and mobile states are covered for every primary route";
 * NFR-006: "Automated checks plus manual keyboard and assistive-technology review".
 *
 * The compiled web app, on an emulated phone (Moto G4, 360 pixels wide), with the API answered in
 * the page by synthetic data its contract accepts. The automated accessibility check is axe-core
 * with the WCAG 2.0, 2.1 and 2.2 A and AA rules. It is not a manual or assistive-technology review.
 */
const PRIMARY = [
  "/library",
  "/compliance",
  "/industries",
  "/resources",
  "/services",
  "/pricing",
  "/support",
  "/help",
  "/privacy",
  "/terms",
];
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
let browser: Browser | undefined;
let server: ChildProcess | undefined;
let origin = "";

/** Synthetic API answers for the public pages: with published items, or with none. */
function answers(published: boolean) {
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
    publishedItems: published ? industry.publishedItems : 0,
  }));
  const items = published
    ? Array.from({ length: 12 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        templateId: `TPL-${String(i + 1).padStart(2, "0")}`,
        slug: `synthetic-template-${i + 1}`,
        title: `Synthetic business template ${i + 1}`,
        type: "template",
        industry: industries[i % industries.length]!.slug,
        category: ["Finance and operations", "People", "Sales", "Records"][i % 4]!,
        access: i % 3 ? ("premium" as const) : ("free" as const),
        summary: "Synthetic test fixture describing what this template records.",
        href: `/library/synthetic-template-${i + 1}`,
        reviewedAt: "2026-11-01T00:00:00.000Z",
      }))
    : [];
  const resources = published
    ? Array.from({ length: 3 }, (_, i) => ({
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
        sources: [],
      }))
    : [];
  return {
    "/public/status": GetBuildStatusResponse.parse({
      receivedRequirements: 127,
      expectedRequirements: 127,
      publishedTemplates: items.length,
      p0Passed: false,
      r2Unlocked: false,
      livePaymentsEnabled: false,
      notice: "Synthetic test fixture.",
    }),
    "/public/coverage": GetPublicCoverageResponse.parse({
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
    "/public/catalogue": ListPublicCatalogueResponse.parse({
      items,
      total: items.length,
      page: 1,
      heldTemplates: 0,
    }),
    "/public/resources": ListReleasedResourcesResponse.parse(resources),
  } as Record<string, unknown>;
}

type Api = (route: Route, path: string) => Promise<void>;
/** A phone-sized page whose API calls `api` answers; any other host is unreachable. */
async function phone(
  path: string,
  api: Api,
): Promise<{ page: Page; unknown: string[]; close: () => Promise<void> }> {
  const context = await browser!.newContext({ ...devices["Moto G4"] });
  const page = await context.newPage();
  const unknown: string[] = [];
  await page.route(`${origin}/api/**`, (route) => {
    const apiPath = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    return api(route, apiPath).catch((error: unknown) => {
      unknown.push(`${apiPath}: ${String(error)}`);
    });
  });
  await page.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
  await page.goto(origin + path, { waitUntil: "load" });
  await page.getByRole("button", { name: "Open menu" }).waitFor({ state: "visible", timeout: 60_000 });
  return { page, unknown, close: () => context.close() };
}

const answer =
  (published: boolean): Api =>
  async (route, path) => {
    const body = answers(published)[path];
    if (body === undefined) throw Error("no test answer");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  };

/** The axe-core rules that fail on the page once its entrance animations have finished. */
async function wcagFailures(page: Page) {
  // A heading still fading in has the contrast of its current opacity, not its own. Polled, since the
  // page's content security policy refuses the eval that waitForFunction uses for a string.
  for (let poll = 0; poll < 100; poll++) {
    if (await page.evaluate("document.getAnimations().every((a) => a.playState !== 'running')")) break;
    await delay(100);
  }
  if (!(await page.evaluate("typeof window.axe !== 'undefined'")))
    await page.addScriptTag({ content: axe.source });
  return (await page.evaluate(
    `axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(WCAG)} } })
      .then((r) => ({ passes: r.passes.length, failures: r.violations.map((v) => v.id + " (" + v.impact + "): " + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")) }))`,
  )) as { passes: number; failures: string[] };
}

before(async () => {
  const front = resolve(import.meta.dirname, "../../../valo");
  // Pass only OS essentials; never inherit provider or database credentials.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => /^(PATH|HOME|LANG|LC_ALL|TMPDIR)$/i.test(key)),
  );
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  origin = `http://127.0.0.1:${port}`;
  const next = createRequire(resolve(front, "package.json")).resolve("next/dist/bin/next");
  server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: front,
    env: { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "ignore",
  });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    assert.equal(server.exitCode, null, "the compiled web app started");
    ready = await fetch(origin + "/library").then(
      (response) => response.ok,
      () => false,
    );
    if (!ready) await delay(250);
  }
  assert.ok(ready, "the compiled web app answers; build it first: pnpm --filter @workspace/valo run build");
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"],
  });
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
});

test("on a phone, each primary public page fits the screen, moves keyboard focus only to visible outlined elements and has no automated WCAG 2.2 AA failure", async () => {
  for (const path of PRIMARY) {
    const { page, unknown, close } = await phone(path, answer(true));
    try {
      await delay(1000); // Let the page's data arrive.
      assert.equal(
        await page.evaluate("document.documentElement.scrollWidth"),
        360,
        `${path} scrolls sideways`,
      );
      for (let step = 1; step <= 8; step++) {
        await page.keyboard.press("Tab");
        const focus = (await page.evaluate(`(() => {
          const e = document.activeElement, s = getComputedStyle(e), box = e.getBoundingClientRect();
          return { name: e.tagName + " " + (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30),
            visible: box.width > 0 && box.height > 0 && s.visibility === "visible",
            outlined: (s.outlineStyle !== "none" && s.outlineWidth !== "0px") || s.boxShadow !== "none" };
        })()`)) as { name: string; visible: boolean; outlined: boolean };
        assert.ok(focus.visible, `${path}: Tab ${step} focused a hidden element (${focus.name})`);
        assert.ok(focus.outlined, `${path}: Tab ${step} focus on ${focus.name} has no visible outline`);
      }
      const { passes, failures } = await wcagFailures(page);
      assert.ok(passes > 10, `${path}: axe ran ${passes} passing rules`);
      assert.deepEqual(failures, [], path);
      assert.deepEqual(unknown, [], `${path}: every API call has a test answer`);
    } finally {
      await close();
    }
  }
});

test("a public page waiting for its data shows a loading placeholder, then an empty state when nothing is published", async () => {
  for (const path of ["/library", "/compliance", "/resources"]) {
    let release!: () => void;
    const released = new Promise<void>((done) => (release = done));
    const empty = answer(false);
    const { page, unknown, close } = await phone(path, async (route, apiPath) => {
      await released;
      await empty(route, apiPath);
    });
    try {
      await page.locator("main .animate-pulse").first().waitFor({ state: "visible" });
      assert.equal(await page.getByTestId("status-error").count(), 0, `${path} shows no error while loading`);
      release();
      await page.getByTestId("status-empty").first().waitFor({ state: "visible" });
      assert.equal(
        await page.locator("main .animate-pulse").count(),
        0,
        `${path} loading placeholder is gone`,
      );
      assert.deepEqual((await wcagFailures(page)).failures, [], `${path} empty state`);
      assert.deepEqual(unknown, [], `${path}: every API call has a test answer`);
    } finally {
      release();
      await close();
    }
  }
});

test("a public page whose data fails to load shows an alert with a retry button, and retrying recovers", async () => {
  for (const path of ["/library", "/compliance", "/industries", "/resources"]) {
    let failing = true;
    const recovered = answer(true);
    const { page, unknown, close } = await phone(path, async (route, apiPath) => {
      if (failing)
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"error":"Synthetic failure"}',
        });
      else await recovered(route, apiPath);
    });
    try {
      const alert = page.getByTestId("status-error").first();
      await alert.waitFor({ state: "visible", timeout: 30_000 });
      assert.equal(await alert.getAttribute("role"), "alert");
      assert.deepEqual((await wcagFailures(page)).failures, [], `${path} error state`);
      failing = false;
      // One retry can bring back several sections, so press whichever retry button remains.
      for (let press = 0; press < 5 && (await page.getByTestId("button-retry").count()) > 0; press++) {
        await page.getByTestId("button-retry").first().click();
        await delay(500);
      }
      await page.getByTestId("status-error").first().waitFor({ state: "detached", timeout: 30_000 });
      assert.deepEqual(unknown, [], `${path}: every API call has a test answer`);
    } finally {
      await close();
    }
  }
});
