import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, devices, type Browser, type Page, type Route } from "playwright";
import { expect } from "@playwright/test";
import axe from "axe-core";
import {
  GetBuildStatusResponse,
  GetPublicCoverageResponse,
  ListPublicCatalogueResponse,
  ListReleasedResourcesResponse,
} from "@workspace/api-zod";
import { coveragePlan } from "@workspace/valo-core";
import { chromiumLaunchPath } from "../platform/chromium";
import { atRest } from "../test-support/app-in-browser";

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

/** The axe-core rules that fail on the page once its entrance animations have finished and it has
 * stopped scrolling. */
async function wcagFailures(page: Page) {
  await atRest(page);
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
    ...chromiumLaunchPath(),
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

// The industries page reads the industries and, for the count under each, the published guides.
test("the industries page waiting for its data shows a loading placeholder, then lists every industry and says of each that it has no guides when none is published; a search that names no industry says so and offers the whole list again", async () => {
  const industries = coveragePlan().industries;
  const rows = (page: Page) => page.locator('[data-testid^="row-industry-"]');
  let release!: () => void;
  const released = new Promise<void>((done) => (release = done));
  const empty = answer(false);
  const { page, unknown, close } = await phone("/industries", async (route, apiPath) => {
    await released;
    await empty(route, apiPath);
  });
  try {
    await page.locator("main .animate-pulse").first().waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("status-error").count(), 0, "no error while loading");
    assert.equal(await rows(page).count(), 0, "no industry is listed before the list arrives");
    release();
    await expect(rows(page)).toHaveCount(industries.length);
    await expect(page.locator("main .animate-pulse")).toHaveCount(0);
    for (const row of await rows(page).allInnerTexts()) assert.match(row, /\nNo guides yet$/, row);
    assert.deepEqual((await wcagFailures(page)).failures, [], "/industries with no guide published");

    // A search that names no industry.
    await page.getByTestId("input-industry-search").fill("no such industry");
    const none = page.locator("main [role='status']").filter({ hasText: "No industries match" });
    await expect(none).toContainText("No industries match “no such industry”.");
    await expect(rows(page)).toHaveCount(0);
    assert.deepEqual((await wcagFailures(page)).failures, [], "/industries with no industry matching");
    await none.getByRole("button", { name: "Show all industries" }).click();
    await expect(rows(page)).toHaveCount(industries.length);
    await expect(page.getByTestId("input-industry-search")).toHaveValue("");
    assert.deepEqual(unknown, [], "/industries: every API call has a test answer");
  } finally {
    release();
    await close();
  }

  // With guides published, an industry says how many it has. The three synthetic guides are filed
  // under the first three industries, one each.
  {
    const { page, close } = await phone("/industries", answer(true));
    try {
      await expect(rows(page)).toHaveCount(industries.length);
      const said = await rows(page).allInnerTexts();
      assert.deepEqual(
        said.map((row) => row.split("\n").at(-1)),
        industries.map((_, index) => (index < 3 ? "1 guide" : "No guides yet")),
      );
    } finally {
      await close();
    }
  }
});

// The pricing page's one read, made in the browser when the web server could not make it.
test("the pricing page waiting to learn whether payments are on shows a placeholder, then says what the API answered; when the API refuses or cannot be reached it says they are switched off, and shows no error", async () => {
  const said = (page: Page) => page.getByTestId("text-payments-status");
  for (const [live, words] of [
    [false, "Switched off"],
    [true, "Enabled"],
  ] as const) {
    let release!: () => void;
    const released = new Promise<void>((done) => (release = done));
    const { page, unknown, close } = await phone("/pricing", async (route, apiPath) => {
      if (apiPath !== "/public/status") throw Error("no test answer");
      await released;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          GetBuildStatusResponse.parse({
            ...(answers(true)["/public/status"] as object),
            livePaymentsEnabled: live,
          }),
        ),
      });
    });
    try {
      await page.locator("main .animate-pulse").first().waitFor({ state: "visible" });
      assert.equal(await said(page).count(), 0, "nothing is said before the answer");
      release();
      await expect(said(page)).toHaveText(words);
      await expect(page.locator("main .animate-pulse")).toHaveCount(0);
      assert.deepEqual((await wcagFailures(page)).failures, [], `/pricing saying "${words}"`);
      assert.deepEqual(unknown, [], "/pricing: every API call has a test answer");
    } finally {
      release();
      await close();
    }
  }
  for (const failure of ["refuses", "cannot be reached"] as const) {
    const { page, close } = await phone("/pricing", (route) =>
      failure === "refuses"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: '{"error":"Synthetic failure"}',
          })
        : route.abort(),
    );
    try {
      await expect(said(page)).toHaveText("Switched off");
      await expect(page.locator("main .animate-pulse")).toHaveCount(0);
      assert.equal(await page.getByTestId("status-error").count(), 0, "the page shows no error");
      assert.deepEqual((await wcagFailures(page)).failures, [], `/pricing when the API ${failure}`);
    } finally {
      await close();
    }
  }
});

/** The primary pages whose content is whole in the server's HTML, with what each shows. The two
 * forms need a signed-in account, and the sign-in service is not reachable in this test. */
const WHOLE: { path: string; heading: string; shows: string; form?: true }[] = [
  { path: "/services", heading: "Ask about a service", shows: "main ul li", form: true },
  { path: "/support", heading: "Report a problem", shows: 'main a[href="/account-access"]', form: true },
  { path: "/help", heading: "Questions and answers", shows: '[data-testid^="faq-"]' },
  { path: "/privacy", heading: "What Valo does with your data", shows: '[data-testid^="privacy-entry-"]' },
  { path: "/terms", heading: "Terms of use, not yet approved", shows: "main h2" },
];

test("the services, support, help, privacy and terms pages wait for nothing and have nothing that can fail to load: with the API failing each shows its whole content, and until the sign-in service answers each form's place shows the way to sign in or to write without an account", async () => {
  for (const { path, heading, shows, form } of WHOLE) {
    const calls: string[] = [];
    const { page, close } = await phone(path, async (route, apiPath) => {
      calls.push(apiPath);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"Synthetic failure"}',
      });
    });
    try {
      // The support page is drawn by the browser app, once its own files have loaded.
      await expect(page.locator("main h1")).toHaveText(heading, { timeout: 30_000 });
      await expect(page.locator(shows).first()).toBeVisible();
      if (form) {
        const signedOut = page.getByTestId("ticket-signed-out");
        await expect(signedOut).toContainText("Sign in to send this");
        for (const [name, href] of [
          ["Sign in", "/sign-in"],
          ["Create an account", "/sign-up"],
          ["Write without an account", "/contact"],
        ] as const)
          await expect(signedOut.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
      }
      await delay(1000); // Time for a read to start, were there one.
      assert.equal(await page.locator("main .animate-pulse").count(), 0, `${path} shows no placeholder`);
      assert.equal(await page.locator("main [aria-busy='true']").count(), 0, `${path} is not waiting`);
      assert.equal(await page.getByTestId("status-error").count(), 0, `${path} shows no error`);
      assert.deepEqual(calls, [], `${path} asks the API for nothing`);
      assert.deepEqual((await wcagFailures(page)).failures, [], path);
    } finally {
      await close();
    }
  }
});

// WEB-002: "search/filter URLs must be shareable."
test("the guides, industries and help pages keep their search and filter in the address: a copied address opens the same view, and Back undoes a change", async () => {
  const [first, second] = coveragePlan().industries;
  const at = (page: Page) => page.url().slice(origin.length);

  // The guides. The second synthetic guide is filed under the second industry alone.
  {
    const shared = `/resources?q=guidance+2&industry=${second!.slug}`;
    const { page, unknown, close } = await phone(shared, answer(true));
    try {
      const box = page.getByTestId("input-guide-search"),
        industry = page.locator("#guide-industry"),
        count = page.getByTestId("text-resource-count");
      // A shared address opens the view it names.
      await expect(count).toHaveText("1 guide");
      await expect(box).toHaveValue("guidance 2");
      await expect(industry).toHaveValue(second!.slug);
      await expect(page.locator('[data-testid^="card-resource-"]')).toHaveCount(1);
      await expect(box).toHaveAttribute("maxlength", "120");
      await delay(500);
      assert.equal(at(page), shared, "opening a view does not change its address");
      // A changed filter is in the address at once.
      await industry.selectOption(first!.slug);
      await expect(count).toHaveText("0 guides");
      await expect.poll(() => at(page)).toBe(`/resources?q=guidance+2&industry=${first!.slug}`);
      // With nothing searched for and no filter, the page has its plain address.
      await page.getByRole("button", { name: "Show all guides" }).click();
      await expect(count).toHaveText("3 guides");
      await expect(box).toHaveValue("");
      await expect.poll(() => at(page)).toBe("/resources");
      // What is typed filters the page at once, and is in the address a moment later. A space typed
      // at the end is not part of the search, and stays in the box for the next word.
      await box.fill("guidance ");
      await expect.poll(() => at(page)).toBe("/resources?q=guidance");
      await delay(500);
      await expect(box).toHaveValue("guidance ");
      await box.press("End");
      await box.press("3");
      await expect(box).toHaveValue("guidance 3");
      await expect(count).toHaveText("1 guide");
      await expect.poll(() => at(page)).toBe("/resources?q=guidance+3");
      // Back undoes each change, and refills the box.
      await page.goBack();
      await expect.poll(() => at(page)).toBe("/resources?q=guidance");
      await expect(box).toHaveValue("guidance");
      await expect(count).toHaveText("3 guides");
      await page.goBack();
      await expect.poll(() => at(page)).toBe("/resources");
      await expect(box).toHaveValue("");
      await page.goBack();
      await expect.poll(() => at(page)).toBe(`/resources?q=guidance+2&industry=${first!.slug}`);
      await expect(box).toHaveValue("guidance 2");
      await expect(industry).toHaveValue(first!.slug);
      await expect(count).toHaveText("0 guides");
      assert.deepEqual(unknown, [], "/resources: every API call has a test answer");
    } finally {
      await close();
    }
  }

  // The industries, searched by a word of the first industry's name.
  {
    const word = first!.slug.split("-")[0]!;
    const named = (text: string) =>
      coveragePlan().industries.filter((industry) =>
        `${industry.title} ${industry.slug.replaceAll("-", " ")}`.toLowerCase().includes(text),
      ).length;
    // An address written with spaces around its search opens as it is: the page puts no address of
    // its own after it, which the Back button would only return to again.
    const padded = `/industries?q=%20${word}%20`;
    const { page, unknown, close } = await phone(padded, answer(true));
    try {
      const box = page.getByTestId("input-industry-search"),
        rows = page.locator('[data-testid^="row-industry-"]');
      await expect(box).toHaveValue(word);
      await expect(box).toHaveAttribute("maxlength", "120");
      await expect(rows).toHaveCount(named(word));
      await expect(page.getByTestId("row-industry-" + first!.slug)).toBeVisible();
      assert.ok(named(word) < coveragePlan().industries.length, "the word does not name every industry");
      await delay(500);
      assert.equal(at(page), padded);
      await box.fill("no such industry");
      await expect(page.getByRole("button", { name: "Show all industries" })).toBeVisible();
      await expect.poll(() => at(page)).toBe("/industries?q=no+such+industry");
      await page.getByRole("button", { name: "Show all industries" }).click();
      await expect(rows).toHaveCount(coveragePlan().industries.length);
      await expect.poll(() => at(page)).toBe("/industries");
      await page.goBack();
      await expect(box).toHaveValue("no such industry");
      await page.goBack();
      await expect(box).toHaveValue(word);
      await expect(rows).toHaveCount(named(word));
      assert.deepEqual(unknown, [], "/industries: every API call has a test answer");
    } finally {
      await close();
    }
  }

  // The help page's questions. Its page is the same for everyone, and the search is applied in the browser.
  {
    const { page, unknown, close } = await phone("/help?q=reminder", answer(true));
    try {
      const box = page.getByTestId("input-help-search"),
        said = page.getByTestId("status-help-matches"),
        shown = page.locator('[data-testid^="faq-"]:visible');
      await expect(box).toHaveValue("reminder");
      await expect(box).toHaveAttribute("maxlength", "120");
      await expect(said).toHaveText(/^Showing \d+ of \d+ questions\.$/);
      const [, matches, total] = /^Showing (\d+) of (\d+)/.exec(await said.innerText())!;
      assert.ok(+matches! >= 1 && +matches! < +total!, `some questions and not all: ${matches} of ${total}`);
      await expect(shown).toHaveCount(+matches!);
      for (const question of await shown.allInnerTexts()) assert.match(question, /reminder/i);
      await box.fill("no such question");
      await expect(said).toContainText('No questions match "no such question".');
      await expect.poll(() => at(page)).toBe("/help?q=no+such+question");
      await page.getByTestId("button-clear-help-search").click();
      await expect(shown).toHaveCount(+total!);
      await expect.poll(() => at(page)).toBe("/help");
      await page.goBack();
      await page.goBack();
      await expect(box).toHaveValue("reminder");
      await expect(shown).toHaveCount(+matches!);
      assert.deepEqual(unknown, [], "/help: every API call has a test answer");
    } finally {
      await close();
    }
  }
});
