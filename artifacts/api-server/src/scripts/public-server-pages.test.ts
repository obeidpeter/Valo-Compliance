import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import { paginateReleasedItems, type ReleasedLibraryItem } from "../modules/catalogue/valo-catalogue";
import { phoneProblems, ready } from "../test-support/app-in-browser";
import { industry, items, resources, serverAnswer } from "../test-support/public-answers";
import { HYDRATION, startWebServer } from "../test-support/web-server";

/**
 * Decision 0011: the public pages the server renders, checked against the compiled web app in
 * production mode, pointed at a synthetic API on this machine whose answers the API contract's schemas
 * accept. Plain HTTP requests read the server's HTML; a browser on an emulated phone (Moto G4) checks
 * what needs one. The automated accessibility check is axe-core with the WCAG 2.0, 2.1 and 2.2 A and
 * AA rules, not a manual or assistive-technology review.
 */
// The web app's own lists, read from its source: the pages it server-renders and each fixed page's
// title. Loaded at run time, since this package's build cannot import another package's source.
const webSource = (file: string) =>
  pathToFileURL(resolve(import.meta.dirname, "../../../valo/src/lib", file)).href;
const { SERVER_PAGES, isServerPage } = (await import(webSource("server-pages.ts"))) as {
  SERVER_PAGES: readonly string[];
  isServerPage: (href: string) => boolean;
};
const { publicPages } = (await import(webSource("public-pages.ts"))) as {
  publicPages: Record<string, { title: string }>;
};

/** How the synthetic API answers the web server while a test sets it: as the production gate does
 * (not found), with its rate limit's refusal, or not at all. The browser is always answered. */
let serverFailure: 404 | 429 | "silent" | null = null;
/** While a test sets it, the browser's own reads get an answer of the wrong shape. */
let browserGarbled = false;
/** While a test sets it, the catalogue is answered from these items, filtered, sorted and paged as
 * the API's own catalogue code does. */
let catalogueItems: ReleasedLibraryItem[] | null = null;

let web: Awaited<ReturnType<typeof startWebServer>>;
before(async () => {
  web = await startWebServer((method, url, from) =>
    from === "server" && serverFailure !== null
      ? serverFailure === "silent"
        ? { status: 200, body: {}, delayMs: 5000 }
        : { status: serverFailure, body: { error: "Synthetic refusal" } }
      : from === "browser" && browserGarbled && url.pathname.startsWith("/api/public/")
        ? { status: 200, body: { unexpected: "synthetic answer of the wrong shape" } }
        : catalogueItems && url.pathname === "/api/public/catalogue"
          ? {
              status: 200,
              body: paginateReleasedItems(catalogueItems, {
                ...Object.fromEntries(url.searchParams),
                page: Number(url.searchParams.get("page") ?? 1),
              }),
            }
          : serverAnswer(method, url),
  );
});
after(() => web.close());

/** The heading each server-rendered page's own content starts with: every fixed page the server
 * renders, and one released item's page of each kind. */
const HEADINGS: Record<string, string> = {
  "/terms": "Terms of use, not yet approved",
  "/about": "Two shelves, kept apart on purpose.",
  "/help": "Straight answers",
  "/contact": "Write to the people building Valo.",
  "/privacy": "How this build handles data",
  "/pricing": "Prices have not been set.",
  "/library": "Find the right starting point",
  "/resources": "Guidance that names its sources.",
  "/industries": "Find what fits your trade.",
  "/compliance": "No rule is shown until it can name its source.",
  "/services": "Need a person, not a page?",
  [items[0]!.href]: items[0]!.title,
  [`/resources/${resources[0]!.slug}`]: resources[0]!.title,
  [`/industries/${industry.slug}`]: industry.title,
};
const PAGES = Object.keys(HEADINGS);
/** The title each of those pages gives itself. */
const title = (path: string) => publicPages[path]?.title ?? `${HEADINGS[path]} — Valo`;

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();

test("each server-rendered public page is in the server's HTML, with its heading, content and the site's frame, before any script runs", async () => {
  assert.deepEqual(
    SERVER_PAGES.filter((path) => !PAGES.includes(path)),
    [],
    "every fixed page the server renders is checked",
  );
  assert.deepEqual(
    PAGES.filter((path) => !isServerPage(path)),
    [],
    "each checked page is one the server renders",
  );
  for (const path of PAGES) {
    const response = await fetch(web.origin + path);
    assert.equal(response.status, 200, path);
    assert.equal(
      response.headers.get("cache-control"),
      "private, no-store, max-age=0",
      `${path} is never cached`,
    );
    const html = await response.text();
    assert.equal(
      text(/<main[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ""),
      HEADINGS[path],
      path,
    );
    for (const part of [
      'data-testid="text-dev-banner"',
      'aria-label="Primary"',
      'aria-label="Open menu"',
      "<footer",
      'data-testid="mobile-dock"',
      'data-testid="link-signin"',
    ])
      assert.ok(html.includes(part), `${path} renders ${part} on the server`);
    assert.match(
      html,
      /<meta name="robots" content="noindex, nofollow"\/>/,
      `${path} stays out of search engines`,
    );
  }
});

test("the web server renders a page the same for every visitor and reads the API as an anonymous one, passing on the forwarded address", async () => {
  const visitor = {
    cookie: "__session=synthetic-session-token; __client_uat=1",
    authorization: "Bearer synthetic-bearer-token",
    "x-forwarded-for": "203.0.113.10, 198.51.100.7",
  };
  /** The page's HTML with its response's own nonce, wherever it appears, replaced. */
  const page = async (path: string, headers: Record<string, string> = {}) => {
    const response = await fetch(web.origin + path, { headers });
    const nonce = /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")![1]!;
    return (await response.text()).replaceAll(nonce, "response-nonce");
  };
  const before = web.api.requests.length;
  for (const path of SERVER_PAGES)
    assert.equal(await page(path, visitor), await page(path), `${path} is the same with a session`);
  // A released item's metadata is read from the API while the server renders its page.
  const detail = await (await fetch(web.origin + items[0]!.href, { headers: visitor })).text();
  assert.match(detail, new RegExp(`<title>${items[0]!.title} — Valo</title>`));
  const reads = web.api.requests.slice(before);
  for (const read of reads) {
    assert.equal(read.cookie, undefined, `${read.path} carried no cookie`);
    assert.equal(read.authorization, undefined, `${read.path} carried no Authorization header`);
  }
  // The visitor's reads carry the address their proxy forwarded, unchanged.
  const passedOn = reads
    .filter((read) => read.forwardedFor === visitor["x-forwarded-for"])
    .map((r) => r.path);
  assert.ok(passedOn.includes("/api/public/status"), "the pricing page's read passed the address on");
  assert.ok(passedOn.includes("/api/public/discovery"), "the item's metadata read passed the address on");
});

test("every script on a server-rendered page carries its response's own nonce, which no other response shares", async () => {
  for (const path of PAGES) {
    const nonces = [];
    for (let i = 0; i < 2; i++) {
      const response = await fetch(web.origin + path);
      const nonce = /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1];
      assert.ok(nonce, `${path} has a nonce in its policy`);
      const scripts = [...(await response.text()).matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      assert.ok(scripts.length > 0, `${path} has scripts`);
      for (const script of scripts)
        assert.ok(script.includes(`nonce="${nonce}"`), `${path}: ${script.slice(0, 80)}`);
      nonces.push(nonce);
    }
    assert.notEqual(nonces[0], nonces[1], `${path} gets a fresh nonce on every response`);
  }
});

test("on a phone, each server-rendered page hydrates without a mismatch, fits 360 and 320 pixels, moves keyboard focus only to visible outlined elements, has no automated WCAG 2.2 AA failure, and its menu opens and closes", async () => {
  const problems: string[] = [];
  for (const path of PAGES) {
    const { page, unknown, errors, messages, close } = await web.phone(path);
    try {
      await ready(page);
      assert.equal(await page.title(), title(path), `${path} names itself`);
      const button = page.getByRole("button", { name: "Open menu" });
      await button.click();
      const menu = page.getByRole("navigation", { name: "Mobile" });
      await menu.waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      if ((await page.evaluate("document.activeElement?.getAttribute('aria-label')")) !== "Open menu")
        problems.push(`${path}: Escape did not return focus to the menu button`);
      problems.push(...(await phoneProblems(page, path)));
      problems.push(...[...errors, ...messages].filter((m) => HYDRATION.test(m)).map((m) => `${path}: ${m}`));
      problems.push(...errors.map((error) => `${path}: page error ${error}`));
      problems.push(...unknown.map((call) => `${path}: no test answer for ${call}`));
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

/** Each page the footer links to, and the title it gives the page. */
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
  const { page, unknown, errors, close } = await web.phone("/terms");
  /** Follows a link with the keyboard, as a visitor using Tab and Enter would, and reads the title.
   * Between a server-rendered page and the browser app the new page loads in full; within either it
   * does not. */
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
    await page.waitForURL(web.origin + path).catch(() => problems.push(`${selector} did not open ${path}`));
    for (let poll = 0; poll < 50 && (await page.title()) !== title; poll++) await delay(100);
    const shown = await page.title();
    if (shown !== title) problems.push(`${path}: titled "${shown}" after moving to it`);
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

test("a server-rendered page reached inside the browser app without a full load is handed to the server", async () => {
  // The support page is one the browser app renders.
  const { page, errors, close } = await web.phone("/support");
  try {
    await ready(page);
    // As a link in one of the app's own screens would: the app's router moves to the address.
    await page.evaluate(
      "history.pushState(null, '', '/terms'); dispatchEvent(new PopStateEvent('popstate'))",
    );
    for (let poll = 0; poll < 100; poll++) {
      const loaded = await page
        .evaluate<string>(
          "performance.getEntriesByType('navigation')[0].type + ' ' + (document.querySelector('main h1')?.textContent ?? '')",
        )
        .catch(() => "");
      if (loaded === `reload ${HEADINGS["/terms"]}`) break;
      await delay(100);
    }
    assert.equal(
      await page.evaluate<string>("performance.getEntriesByType('navigation')[0].type"),
      "reload",
      "the app reloaded the address",
    );
    assert.equal(await page.locator("main h1").textContent(), HEADINGS["/terms"]);
    assert.equal(await page.title(), "Terms — Valo");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("the library's filters, sort and page live in its address: the server renders the results an address asks for, a reload keeps them, a new search starts again from the first page, and clearing the filters empties the address", async () => {
  // Twenty-three released templates of one kind: a full first page of 20 and three on the second.
  catalogueItems = Array.from({ length: 23 }, (_, i) => ({
    ...items[0]!,
    id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`,
    slug: `synthetic-filter-template-${i + 1}`,
    title: `Synthetic filter template ${String(i + 1).padStart(2, "0")}`,
    href: `/library/synthetic-filter-template-${i + 1}`,
    category: "Finance and operations",
    access: "free",
    industry: industry.slug,
  }));
  const cards = 'li[data-testid^="card-item-"]';
  try {
    // The server renders the second page of the filtered, sorted results from the address alone.
    const query = new URLSearchParams({
      category: "Finance and operations",
      access: "free",
      industry: industry.slug,
      sort: "name",
      page: "2",
    });
    const address = `/library?${query.toString()}`;
    const html = await (await fetch(web.origin + address)).text();
    assert.equal(html.match(/data-testid="card-item-/g)?.length, 3, "the server rendered the second page");

    const { page, unknown, errors, close } = await web.phone("/library");
    try {
      await ready(page);
      await page.getByTestId("select-category").selectOption("Finance and operations");
      await page.getByTestId("select-access").selectOption("free");
      await page.getByTestId("select-industry").selectOption(industry.slug);
      await page.getByTestId("select-sort").selectOption("name");
      await page.reload();
      await ready(page);
      assert.equal(await page.getByTestId("select-category").inputValue(), "Finance and operations");
      assert.equal(await page.getByTestId("select-access").inputValue(), "free");
      assert.equal(await page.getByTestId("select-industry").inputValue(), industry.slug);
      assert.equal(await page.getByTestId("select-sort").inputValue(), "name");
      await page.getByTestId("button-next").click();
      await page.waitForURL(/[?&]page=2\b/);
      // The page's policy allows no eval, so the cards are counted with a locator.
      await expect(page.locator(cards)).toHaveCount(3);
      await page.getByTestId("input-search").fill("not-found-fixture");
      await page.getByTestId("button-search").click();
      await page.getByTestId("status-empty").waitFor();
      assert.ok(!new URL(page.url()).searchParams.has("page"), "a new search starts from the first page");
      await page.getByTestId("button-clear-filters").click();
      await expect(page.locator(cards)).toHaveCount(20);
      assert.equal(new URL(page.url()).search, "", "clearing the filters empties the address");
      assert.deepEqual(unknown, [], "every API call the page made has a test answer");
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  } finally {
    catalogueItems = null;
  }
});

test("when the API answers the web server as its production gate does, refuses or does not answer, each page still renders within the time limit and the browser reads what the server could not", async () => {
  /** Each page, what the server could not render without the API, and what shows once the browser
   * has read it. */
  const cases = [
    { path: "/pricing", missing: 'data-testid="text-payments-status"', shown: "text-payments-status" },
    { path: "/library", missing: 'data-testid="card-item-', shown: `card-item-${items[0]!.id}` },
    { path: items[0]!.href, missing: 'data-testid="section-preview"', shown: "section-preview" },
  ];
  const problems: string[] = [];
  for (const failure of [404, 429, "silent"] as const)
    for (const { path, missing, shown } of cases) {
      serverFailure = failure;
      try {
        const started = performance.now();
        const html = await (await fetch(web.origin + path)).text();
        const took = performance.now() - started;
        if (took > 4000) problems.push(`${path} ${failure}: the page took ${took.toFixed(0)} ms`);
        if (html.includes(missing))
          problems.push(`${path} ${failure}: the server rendered what it could not read`);
        // The browser is answered, so the page fills in what the server could not.
        const { page, errors, close } = await web.phone(path);
        try {
          await page.getByTestId(shown).first().waitFor({ state: "visible", timeout: 15_000 });
          if (path === "/pricing" && (await page.getByTestId(shown).textContent()) !== "Switched off")
            problems.push(
              `${path} ${failure}: payments shown as ${await page.getByTestId(shown).textContent()}`,
            );
          problems.push(...errors.map((error) => `${path} ${failure}: page error ${error}`));
        } catch (error) {
          problems.push(`${path} ${failure}: ${String(error).split("\n")[0]}`);
        } finally {
          await close();
        }
      } finally {
        serverFailure = null;
      }
    }
  assert.deepEqual(problems, []);
});

test("when a page's island cannot use what the API sent, the page says it could not be shown and keeps the site's frame", async () => {
  serverFailure = 404;
  browserGarbled = true;
  const { page, close } = await web.phone("/library");
  try {
    await page.getByTestId("status-page-error").waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await page.locator("footer").count(), 1, "the footer stays");
    assert.equal(await page.getByRole("button", { name: "Open menu" }).count(), 1, "the header stays");
  } finally {
    serverFailure = null;
    browserGarbled = false;
    await close();
  }
});
