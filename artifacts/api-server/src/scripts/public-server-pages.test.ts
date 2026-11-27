import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import { GetReleasedResourceResponse } from "@workspace/api-zod";
import { paginateReleasedItems, type ReleasedLibraryItem } from "../modules/catalogue/valo-catalogue";
import { menuProblems, phoneProblems, ready } from "../test-support/app-in-browser";
import { oldWordsIn } from "../test-support/old-words";
import { MARK, PROBE, SHORT_MARKUP, type Probe } from "../test-support/hostile-markup";
import { industries, industry, items, resources, serverAnswer } from "../test-support/public-answers";
import { HYDRATION, startWebServer } from "../test-support/web-server";
import { baselineTemplates, processingInventory } from "@workspace/valo-core";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { privacyNotice } from "@workspace/valo-core/privacy-notice";
import { readTemplateIntake } from "../modules/publication/operational-intake";

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
/** While a test sets it, the API no longer lists the first released template and guidance entry, as
 * after their withdrawal: the lists and discovery leave them out, and reading either is not found. */
let withdrawn = false;
/** While a test sets it, the API lists no released guidance at all. */
let noGuidance = false;
/** While a test sets it, the API answers this staff-library guide's page, released with its record
 * (docs/architecture/guidance-record.md, slice 2). */
let recordedGuide: { slug: string } | null = null;
/** While a test sets it, the web server's read of the catalogue is answered after this many
 * milliseconds, inside the web server's own time limit. */
let slowCatalogue = 0;
const [gone, goneGuidance] = [items[0]!, resources[0]!];
/** The API paths of a withdrawn entry the browser has read. */
const browserReadsOfWithdrawn: string[] = [];

/** The synthetic API's answer to the web server or to the browser, as the test's settings say. */
function answerFor(method: string, url: URL, from: "server" | "browser") {
  if (from === "server" && serverFailure !== null)
    return serverFailure === "silent"
      ? { status: 200, body: {}, delayMs: 5000 }
      : { status: serverFailure, body: { error: "Synthetic refusal" } };
  if (from === "browser" && browserGarbled && url.pathname.startsWith("/api/public/"))
    return { status: 200, body: { unexpected: "synthetic answer of the wrong shape" } };
  if (
    withdrawn &&
    [`/api/public/templates/${gone.slug}`, `/api/public/resources/${goneGuidance.slug}`].includes(
      url.pathname,
    )
  ) {
    if (from === "browser") browserReadsOfWithdrawn.push(url.pathname);
    return { status: 404, body: { error: "Not found" } };
  }
  if (noGuidance && url.pathname === "/api/public/resources") return { status: 200, body: [] };
  if (recordedGuide && url.pathname === `/api/public/resources/${recordedGuide.slug}`)
    return { status: 200, body: recordedGuide };
  if (withdrawn && url.pathname === "/api/public/resources")
    return { status: 200, body: resources.filter((resource) => resource.id !== goneGuidance.id) };
  const listed = catalogueItems ?? (withdrawn ? items.filter((item) => item.id !== gone.id) : null);
  if (listed && url.pathname === "/api/public/catalogue")
    return {
      status: 200,
      body: paginateReleasedItems(listed, {
        ...Object.fromEntries(url.searchParams),
        page: Number(url.searchParams.get("page") ?? 1),
      }),
    };
  const found = serverAnswer(method, url);
  if (slowCatalogue && found && from === "server" && url.pathname === "/api/public/catalogue")
    return { ...found, delayMs: slowCatalogue };
  if (withdrawn && found && url.pathname === "/api/public/discovery") {
    const discovery = found.body as { items: { path: string }[] };
    const left = discovery.items.filter(
      (item) => ![gone.href, `/resources/${goneGuidance.slug}`].includes(item.path),
    );
    return { ...found, body: { items: left } };
  }
  return found;
}

let web: Awaited<ReturnType<typeof startWebServer>>;
before(async () => {
  web = await startWebServer(answerFor);
});
after(() => web.close());

/** The heading each server-rendered page's own content starts with: every fixed page the server
 * renders, and one released item's page of each kind. */
const HEADINGS: Record<string, string> = {
  "/": "Make your business documents. Know which rules apply.",
  "/terms": "Terms of use, not yet approved",
  "/about": "Documents and guidance for Nigerian small businesses",
  "/help": "Questions and answers",
  "/contact": "Contact us",
  "/privacy": "What Valo does with your data",
  "/pricing": "Prices have not been set",
  "/library": "Documents and guidance",
  "/resources": "Guides",
  "/industries": "Guidance by industry",
  "/compliance": "Guidance, and where it comes from",
  "/services": "Ask about a service",
  [items[0]!.href]: items[0]!.title,
  [`/resources/${resources[0]!.slug}`]: resources[0]!.title,
  // The list of industries writes its names in lower case; the page and its title start with a capital.
  [`/industries/${industry.slug}`]: industry.title.charAt(0).toUpperCase() + industry.title.slice(1),
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

/** The links inside the first element this pattern opens, read from a page's HTML: each one's words,
 * its address, and whether it is marked as the current page. */
const linksIn = (html: string, opens: RegExp, closes: string) => {
  const from = opens.exec(html)?.index;
  if (from === undefined) return [];
  return [...html.slice(from, html.indexOf(closes, from)).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(
    (link) => ({
      label: text(link[2]!),
      href: /href="([^"]*)"/.exec(link[1]!)?.[1] ?? "",
      current: /aria-current="page"/.test(link[1]!),
    }),
  );
};

/** The header's links in their order, with the server-rendered pages that belong to each one's
 * section. The checker is a page of the browser app, so its own mark is checked in a browser. */
const HEADER: { label: string; href: string; pages: string[] }[] = [
  { label: "Documents", href: "/library", pages: ["/library", items[0]!.href] },
  { label: "Check requirements", href: "/checker", pages: [] },
  {
    label: "Guidance",
    href: "/compliance",
    pages: [
      "/compliance",
      "/resources",
      "/industries",
      `/resources/${resources[0]!.slug}`,
      `/industries/${industry.slug}`,
    ],
  },
  { label: "Pricing", href: "/pricing", pages: ["/pricing"] },
  { label: "Help", href: "/help", pages: ["/help", "/contact"] },
];
/** The tabs that join the three guidance pages. */
const GUIDANCE_TABS = [
  ["Overview", "/compliance"],
  ["Guides", "/resources"],
  ["By industry", "/industries"],
];
/** The footer's three groups. */
const FOOTER_GROUPS = [
  [
    "Product",
    "Documents /library",
    "Check requirements /checker",
    "Guidance /compliance",
    "Pricing /pricing",
  ],
  ["Help", "Help centre /help", "Contact us /contact", "Trouble signing in /account-access"],
  ["Company", "About Valo /about", "Services /services", "Privacy /privacy", "Terms /terms"],
];

test("every server-rendered page has the same five header links and marks its own section, the guidance tabs join their three pages, and the footer has eleven links in three groups", async () => {
  const reached = new Set<string>();
  for (const path of PAGES) {
    const html = await (await fetch(web.origin + path)).text();
    const header = linksIn(html, /<nav[^>]*aria-label="Primary"/, "</nav>");
    assert.deepEqual(
      header.map((link) => [link.label, link.href]),
      HEADER.map((link) => [link.label, link.href]),
      `${path}: the header's links`,
    );
    assert.deepEqual(
      header.filter((link) => link.current).map((link) => link.label),
      HEADER.filter((link) => link.pages.includes(path)).map((link) => link.label),
      `${path}: the section the header marks as current`,
    );
    const tabs = linksIn(html, /<nav[^>]*aria-label="Guidance"/, "</nav>");
    assert.deepEqual(
      tabs.map((tab) => [tab.label, tab.href, tab.current]),
      GUIDANCE_TABS.some(([, href]) => href === path)
        ? GUIDANCE_TABS.map(([label, href]) => [label, href, href === path])
        : [],
      `${path}: the guidance tabs`,
    );
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    assert.deepEqual(
      [...footer.matchAll(/<p class="eyebrow[^"]*">([^<]+)<\/p><ul[^>]*>([\s\S]*?)<\/ul>/g)].map((group) => [
        group[1],
        ...linksIn(group[2]!, /^/, "\u0000").map((link) => `${link.label} ${link.href}`),
      ]),
      FOOTER_GROUPS,
      `${path}: the footer's groups`,
    );
    assert.ok(!footer.includes("/development"), `${path}: the developer notes are not in the footer`);
    for (const link of [...header, ...tabs, ...linksIn(footer, /^/, "\u0000")]) reached.add(link.href);
    if (path === "/help") for (const link of linksIn(html, /<main/, "</main>")) reached.add(link.href);
    reached.add(/<a[^>]*href="([^"]*)"[^>]*data-testid="link-dev-notes"/.exec(html)?.[1] ?? "");
  }
  // Every public page is one link from the header, the footer, the guidance tabs, the help page or
  // the development banner (WEB-002 names the library, compliance, industries, resources, services,
  // pricing, support and legal pages).
  assert.deepEqual(
    [
      "/library",
      "/checker",
      "/compliance",
      "/resources",
      "/industries",
      "/services",
      "/pricing",
      "/help",
      "/support",
      "/contact",
      "/account-access",
      "/about",
      "/privacy",
      "/terms",
      "/development",
    ].filter((page) => !reached.has(page)),
    [],
  );
});

test("the browser app's header has the same links and marks the checker's section, and a phone's menu marks the section too", async () => {
  const wide = await web.desktop("/checker");
  try {
    await ready(wide.page);
    const links = wide.page.getByRole("navigation", { name: "Primary" }).getByRole("link");
    await expect(links).toHaveText(HEADER.map((link) => link.label));
    for (const [index, link] of HEADER.entries())
      await expect(links.nth(index)).toHaveAttribute("href", link.href);
    await expect(wide.page.locator('nav[aria-label="Primary"] [aria-current="page"]')).toHaveText([
      "Check requirements",
    ]);
  } finally {
    await wide.close();
  }
  const narrow = await web.phone("/resources");
  try {
    await ready(narrow.page);
    await narrow.page.getByRole("button", { name: "Open menu" }).tap();
    const menu = narrow.page.getByRole("navigation", { name: "Mobile" });
    await expect(menu.getByRole("link")).toHaveText(HEADER.map((link) => link.label));
    await expect(menu.locator('[aria-current="page"]')).toHaveText(["Guidance"]);
  } finally {
    await narrow.close();
  }
});

test("the web server renders a page the same for every visitor and reads the API as an anonymous one, passing on the forwarded address", async () => {
  const visitor = {
    cookie: "__session=synthetic-session-token; __client_uat=1",
    authorization: "Bearer synthetic-bearer-token",
    "x-forwarded-for": "203.0.113.10, 198.51.100.7",
  };
  /** Where one piece of the page's streamed data ends and the next begins, once the nonce is replaced. */
  const joint = '"])</script><script nonce="response-nonce">self.__next_f.push([1,"';
  /** The page's HTML with its response's own nonce, wherever it appears, replaced. The page's data
   * comes in pieces, each in a script of its own, and a piece can end in the middle of the nonce, as
   * one does in /pricing's data. So the pieces are joined, and a nonce that was split is replaced too. */
  const page = async (path: string, headers: Record<string, string> = {}) => {
    const response = await fetch(web.origin + path, { headers });
    const nonce = /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")![1]!;
    return (await response.text())
      .replaceAll(nonce, "response-nonce")
      .replaceAll(joint, "")
      .replaceAll(nonce, "response-nonce");
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

test("a server-rendered page's opened menu fits a short screen and a phone on its side: every control in it comes to rest on screen and clear of the bottom bar", async () => {
  const problems: string[] = [];
  // Every server-rendered page has the same header, so two stand for them: the home page and a page
  // long enough to scroll.
  for (const path of ["/", "/library"]) {
    const { page, errors, messages, close } = await web.phone(path);
    try {
      await ready(page);
      // The site's five pages, sign in and create account.
      problems.push(...(await menuProblems(page, path, { minimumStops: 7 })));
      problems.push(...errors.map((error) => `${path}: page error ${error}`));
      // The opened menu sets its own height in the page, which the content security policy allows.
      problems.push(
        ...messages.filter((m) => /content security policy/i.test(m)).map((m) => `${path}: ${m}`),
      );
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

test("a server-rendered page's opened menu closes when keyboard focus moves on from the header, so no control on the page is focused under it", async () => {
  const { page, errors, close } = await web.phone("/");
  try {
    await ready(page);
    const button = page.getByTestId("button-menu");
    const menu = page.getByRole("navigation", { name: "Mobile" });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    // Tab goes through the menu's links and then on to the page, which closes the menu.
    let presses = 0;
    while (presses < 40 && (await menu.isVisible())) {
      await page.keyboard.press("Tab");
      presses++;
    }
    await expect(menu).toBeHidden();
    assert.ok(presses > 7, `Tab left the menu after ${presses} presses, before reaching its seven links`);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main :focus")).toHaveCount(1);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

/** Each page the site's own links reach, the link that opens it, and the title it gives the page: the
 * footer's links, then the pages a footer link's page links on to. */
const LINKED: [string, string, string][] = [
  ['footer a[href="/library"]', "/library", "Documents and guidance — Valo"],
  ['footer a[href="/pricing"]', "/pricing", "Pricing — Valo"],
  ['footer a[href="/checker"]', "/checker", "Check your requirements — Valo"],
  ['footer a[href="/compliance"]', "/compliance", "Guidance — Valo"],
  // The guidance tabs join the overview to the guides and the industries.
  ['nav[aria-label="Guidance"] a[href="/resources"]', "/resources", "Guides — Valo"],
  ['nav[aria-label="Guidance"] a[href="/industries"]', "/industries", "Guidance by industry — Valo"],
  ['footer a[href="/services"]', "/services", "Ask about a service — Valo"],
  ['footer a[href="/about"]', "/about", "About Valo"],
  ['footer a[href="/help"]', "/help", "Help — Valo"],
  // The help page links the page for reporting a problem.
  ['main a[href="/support"]', "/support", "Report a problem — Valo"],
  ['footer a[href="/contact"]', "/contact", "Contact us — Valo"],
  ['footer a[href="/account-access"]', "/account-access", "Trouble signing in — Valo"],
  ['footer a[href="/privacy"]', "/privacy", "Privacy — Valo"],
  ['footer a[href="/terms"]', "/terms", "Terms — Valo"],
  // The development banner links the developer notes.
  ['[data-testid="link-dev-notes"]', "/development", "Build status — Valo"],
];

test("moving between public pages in the app, from the site's own links and from a library card, titles each page for itself", async () => {
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
    for (const [selector, path, title] of LINKED) await follow(selector, path, title);
    // A released item's page is titled for the item, and its section again on the way back.
    await follow(`footer a[href="/library"]`, "/library", "Documents and guidance — Valo");
    await follow(`main a[href="${items[0]!.href}"]`, items[0]!.href, `${items[0]!.title} — Valo`);
    await follow(`main a[href="/library"]`, "/library", "Documents and guidance — Valo");
    problems.push(...unknown.map((call) => `no test answer for ${call}`));
    problems.push(...errors.map((error) => `page error ${error}`));
  } finally {
    await close();
  }
  assert.deepEqual(problems, []);
});

test("a click on a link to another server-rendered page says at once that the page is on its way, and the page then arrives in place", async () => {
  slowCatalogue = 1200;
  const { page, errors, close } = await web.desktop("/help");
  try {
    await ready(page);
    await page.locator('header [data-testid="link-nav-documents"]').click();
    // While the new page is still being rendered, the page being left says it is on its way: the
    // bar along the top is drawn and the main content is marked busy.
    await page.waitForFunction('document.documentElement.hasAttribute("data-opening")', undefined, {
      timeout: 1000,
    });
    assert.equal(await page.locator("main h1").first().textContent(), HEADINGS["/help"]);
    assert.equal(await page.locator("#main-content").getAttribute("aria-busy"), "true");
    assert.equal(
      await page.evaluate<string>('getComputedStyle(document.body, "::after").position'),
      "fixed",
      "the bar is drawn",
    );
    // Then the page arrives without a full load, and nothing says it is still on its way.
    await page.waitForURL(web.origin + "/library");
    await expect(page.locator("main h1").first()).toHaveText(HEADINGS["/library"]!);
    await page.waitForFunction('!document.documentElement.hasAttribute("data-opening")');
    assert.equal(await page.locator("#main-content").getAttribute("aria-busy"), null);
    assert.equal(await page.evaluate<string>('getComputedStyle(document.body, "::after").content'), "none");
  } finally {
    slowCatalogue = 0;
    await close();
  }
  assert.deepEqual(errors, []);
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

test("library cards show approved naira prices and free access before and after filtering", async () => {
  const [free, priced, unpriced] = items;
  const priceId = "aa66f97d-bc68-4623-94b1-4a055278ee64";
  const checkout = "/workspace/purchases?offer=" + priceId;
  const purchaserFile = "/api/workspace/templates/" + priced!.id + "/files/docx";
  const signIn = "/sign-in?start=download-" + free!.id + "-" + free!.slug;
  catalogueItems = [
    { ...free!, access: "free", freeDownloadPath: "/api/workspace/templates/" + free!.id + "/files/docx" },
    { ...priced!, access: "premium", amountKobo: 400000, priceId, premiumDownloadPath: purchaserFile },
    { ...unpriced!, access: "premium" },
  ];
  try {
    const address = "/library?type=template";
    const html = await (await fetch(web.origin + address)).text();
    const labels = [
      ...html.replaceAll("<!-- -->", "").matchAll(/data-testid="card-access">([^<]*)<\/span>/g),
    ].map((match) => match[1]);
    assert.deepEqual(labels, ["Free", "Premium · ₦4,000.00", "Premium"]);
    assert.ok(html.includes('href="' + checkout + '"'));
    assert.ok(!html.includes('href="' + purchaserFile + '"'));
    assert.ok(html.includes('href="' + signIn + '"'));
    const { page, close } = await web.phone(address);
    try {
      await ready(page);
      await expect(page.locator('li[data-testid^="card-item-"] a a')).toHaveCount(0);
      await page.getByTestId("select-access").selectOption("premium");
      await expect(page.getByTestId("card-access")).toHaveText(["Premium · ₦4,000.00", "Premium"]);
      await expect(page.getByTestId("card-checkout")).toHaveAttribute("href", checkout);
      await expect(page.getByTestId("card-download")).toHaveCount(0);
      await page.getByTestId("select-access").selectOption("free");
      await expect(page.getByTestId("card-access")).toHaveText(["Free"]);
      await expect(page.getByTestId("card-download")).toHaveAttribute("href", signIn);
      await expect(page.getByTestId("card-checkout")).toHaveCount(0);
    } finally {
      await close();
    }
  } finally {
    catalogueItems = null;
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

test("hostile markup in a page's address is drawn only as text: the server's HTML holds it escaped, and the page runs none of it (SEC-003)", async () => {
  // docs/architecture/hostile-input.md, part 3: the two pages the server draws that read their address,
  // each given hostile markup in every value it reads and in a name of its own.
  const hostile = encodeURIComponent(SHORT_MARKUP);
  const addresses = [
    `/library?q=${hostile}&category=${hostile}&industry=${hostile}&sort=${hostile}&page=${hostile}&${hostile}=${hostile}`,
    `/services?category=${hostile}&${hostile}=${hostile}`,
  ];
  for (const address of addresses) {
    const html = await (await fetch(web.origin + address)).text();
    assert.ok(!html.includes(MARK), `${address}: the server's HTML holds the markup unescaped`);
    const { page, errors, close } = await web.phone(address);
    try {
      await ready(page);
      const drawn = (await page.evaluate(PROBE)) as Probe;
      assert.equal(drawn.ran, null, `${address}: a payload ran`);
      assert.deepEqual(drawn.injected, [], `${address}: the markup made elements`);
      assert.deepEqual(errors, [], `${address}: page errors`);
    } finally {
      await close();
    }
  }
  // The library's search box holds the search it was given, as text, up to the 120 characters it takes.
  const { page, close } = await web.phone(`/library?q=${hostile}`);
  try {
    await ready(page);
    await expect(page.getByRole("searchbox").first()).toHaveValue(SHORT_MARKUP.slice(0, 120));
  } finally {
    await close();
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

/** The everyday tasks the home page offers, in its order. The web app's own unit test ties each one
 * to documents the workspace's starter can start (landing-tasks.test.ts). */
const HOME_TASKS = [
  "Send an invoice",
  "Give a quotation",
  "Issue a receipt",
  "Chase a late payment",
  "Order from a supplier",
  "Record a delivery",
  "Hire someone",
  "Sign an agreement",
];
/** What each of those tasks' links carries into sign-up, in the same order. */
const HOME_TASK_IDS = [
  "invoice",
  "quotation",
  "receipt",
  "reminder",
  "order",
  "delivery",
  "hire",
  "agreement",
];

test("the home page offers both actions in its hero, beside its tasks and at its end, lists its eight everyday tasks, labels its examples as made up, shows the template count the server read and uses no price words", async () => {
  const html = await (await fetch(web.origin + "/")).text();
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const link = (testId: string) => {
    const found = new RegExp(`<a\\b[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</a>`).exec(main);
    return found && { href: /href="([^"]*)"/.exec(found[0])?.[1], label: text(found[1]!) };
  };
  // Documents and requirements side by side, in the same words, wherever the page offers an action.
  for (const place of ["hero", "closing"]) {
    assert.deepEqual(link(`link-${place}-documents`), {
      href: "/sign-up?start=document",
      label: "Create a document",
    });
    assert.deepEqual(link(`link-${place}-compliance`), { href: "/checker", label: "Check my requirements" });
  }
  assert.deepEqual(link("link-tasks-compliance"), { href: "/checker", label: "Check my requirements" });

  const tasks = linksIn(main, /<ul[^>]*data-testid="list-tasks"/, "</ul>");
  // Each task's link carries the task into sign-up.
  assert.deepEqual(
    tasks.map((task) => task.href),
    HOME_TASK_IDS.map((id) => `/sign-up?start=${id}`),
  );
  for (const [index, name] of HOME_TASKS.entries())
    assert.ok(tasks[index]!.label.startsWith(name), `${tasks[index]!.label} is the task "${name}"`);

  // The two examples are a picture with a caption that says their details are made up.
  const figure = /<figure[^>]*data-testid="figure-examples"[\s\S]*?<\/figure>/.exec(main)?.[0] ?? "";
  assert.match(figure, /aria-hidden="true"/);
  assert.match(
    text(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(figure)?.[1] ?? ""),
    /^Examples with made-up details/,
  );

  assert.ok(
    text(main).includes(`There are also ${items.length} ready-made templates to start from.`),
    "the count is the one the API gave",
  );
  // No price is named and nothing is called free: the only amounts are on the example invoice.
  assert.doesNotMatch(text(main.replace(figure, "")), /\bfree\b|₦|\bNGN\b|\bnaira\b|\bkobo\b/i);
});

test("when the API answers the web server as its production gate does, refuses or does not answer, the home page still renders its headline, both actions and its tasks within the time limit, leaving out only the template count", async () => {
  const shown = /\d+ ready-made templates? to start from/;
  const problems: string[] = [];
  for (const failure of [404, 429, "silent"] as const) {
    serverFailure = failure;
    try {
      const started = performance.now();
      const html = await (await fetch(web.origin + "/")).text();
      const took = performance.now() - started;
      if (took > 4000) problems.push(`${failure}: the page took ${took.toFixed(0)} ms`);
      for (const part of [
        'data-testid="text-headline"',
        'data-testid="link-hero-documents"',
        'data-testid="link-hero-compliance"',
        'data-testid="list-tasks"',
      ])
        if (!html.includes(part)) problems.push(`${failure}: the page left out ${part}`);
      if (shown.test(html)) problems.push(`${failure}: the page showed a template count it could not read`);
    } finally {
      serverFailure = null;
    }
  }
  // With the API answering, the server shows the count it read.
  assert.match(await (await fetch(web.origin + "/")).text(), shown);
  assert.deepEqual(problems, []);
});

test("a template or guidance entry the API stops listing is gone from the next page view: its list leaves it out, and its own page says it is not available and does not name it (EDP-011)", async () => {
  const page = async (path: string) => (await fetch(web.origin + path)).text();
  const cases = [
    {
      list: "/library",
      entry: `data-testid="card-item-${gone.id}"`,
      other: `data-testid="card-item-${items[1]!.id}"`,
      path: gone.href,
      api: `/api/public/templates/${gone.slug}`,
      shown: /data-testid="text-title"/,
      title: gone.title,
      unavailable: /This template is not available/,
    },
    {
      list: "/resources",
      entry: `data-testid="card-resource-${goneGuidance.id}"`,
      other: `data-testid="card-resource-${resources[1]!.id}"`,
      path: `/resources/${goneGuidance.slug}`,
      api: `/api/public/resources/${goneGuidance.slug}`,
      shown: /data-testid="text-resource-title"/,
      title: goneGuidance.title,
      unavailable: /This guide is not available/,
    },
  ];
  for (const c of cases) {
    assert.ok((await page(c.list)).includes(c.entry), `${c.list} lists the entry`);
    assert.match(await page(c.path), c.shown, `${c.path} shows it`);
  }
  withdrawn = true;
  try {
    // Nothing is cached between page views (decision 0011, point 5): the next view reads the API again.
    for (const c of cases) {
      const list = await page(c.list);
      assert.ok(!list.includes(c.entry), `${c.list}'s next view leaves the entry out`);
      assert.ok(list.includes(c.other), `${c.list} still lists the others`);
      const detail = await page(c.path);
      assert.match(detail, c.unavailable, `${c.path} says it is not available`);
      assert.doesNotMatch(detail, c.shown, `${c.path} shows none of it`);
      assert.doesNotMatch(detail, new RegExp(`<title>${c.title}`), `${c.path} does not name it in its title`);
      // In the browser the page hydrates as the server rendered it and stays unavailable once the
      // browser's own read is not found either.
      const { page: phone, errors, messages, close } = await web.phone(c.path);
      try {
        await phone.getByText(c.unavailable).waitFor({ state: "visible" });
        for (let poll = 0; poll < 100 && !browserReadsOfWithdrawn.includes(c.api); poll++) await delay(100);
        assert.ok(browserReadsOfWithdrawn.includes(c.api), `the browser read ${c.api} again`);
        assert.equal(await phone.getByText(c.unavailable).count(), 1, `${c.path} stays unavailable`);
        assert.deepEqual(
          [...errors, ...messages].filter((m) => HYDRATION.test(m)),
          [],
          `${c.path} hydrates without a mismatch`,
        );
        assert.deepEqual(errors, [], `${c.path} reports no error`);
      } finally {
        await close();
      }
    }
  } finally {
    withdrawn = false;
  }
});

// CMP-001 (docs/architecture/guidance-record.md, slice 2): a regulatory guide released with its record
// says whom it is for and what to do and keep, links its released related templates, and names each
// source's issuing body and the day its text took effect.
test("a staff-library guide released with its record says whom it is for, what to do and keep, its related templates and each source's issuer and start date, in the server's HTML", async () => {
  const slug = "manual-00000000-0000-4000-8000-0000000000d1";
  recordedGuide = GetReleasedResourceResponse.parse({
    ...resources[0]!,
    id: "00000000-0000-4000-8000-0000000000d2",
    slug,
    title: "Synthetic guide with its record",
    publicationMethod: "manual",
    disclosure:
      "The Valo development owner checked this version against the official sources shown. This article received no independent professional review.",
    scope: "Nigerian national rules on this subject.",
    limitations: "General information. State and local requirements and individual facts may differ.",
    sources: [
      {
        url: "https://example.test/synthetic-act",
        title: "Synthetic Act",
        locator: "Section 2",
        issuingBody: "Synthetic Data Commission",
        effectiveFrom: "2023-06-12T00:00:00+01:00",
      },
      {
        url: "https://example.test/synthetic-page",
        title: "Synthetic page",
        locator: "the page as captured",
      },
    ],
    appliesTo: "Synthetic businesses that collect their customers' details.",
    actionEvidence: "Tell each customer what you collect, and keep a copy of what you told them.",
    relatedTemplates: [
      {
        number: "TPL-29",
        title: "Privacy notice",
        href: "/library/manual-00000000-0000-4000-8000-0000000000d3",
      },
    ],
  });
  try {
    const html = await (await fetch(`${web.origin}/resources/${slug}`)).text();
    const shown = text(html);
    for (const words of [
      "Who this is for",
      "Synthetic businesses that collect their customers' details.",
      "What to do and keep",
      "Tell each customer what you collect, and keep a copy of what you told them.",
      "Related templates",
      "Privacy notice",
      "Issued by Synthetic Data Commission, in effect from 12 Jun 2023",
    ])
      assert.ok(shown.includes(words), `the page says ${words}`);
    // The record's "Who this is for" replaces the fixed "What it covers".
    assert.ok(!shown.includes("What it covers"));
    assert.match(html, /href="\/library\/manual-00000000-0000-4000-8000-0000000000d3"/);
    // A web page has no start date, and a source without an issuer says none.
    assert.match(html, /data-testid="text-resource-source-issuer-0"/);
    assert.doesNotMatch(html, /data-testid="text-resource-source-issuer-1"/);
    const { page, unknown, errors, messages, close } = await web.phone(`/resources/${slug}`);
    try {
      await ready(page);
      await expect(page.getByTestId("text-resource-applies-to")).toHaveText(
        "Synthetic businesses that collect their customers' details.",
      );
      await expect(page.getByTestId("list-resource-related-templates").getByRole("link")).toHaveAttribute(
        "href",
        "/library/manual-00000000-0000-4000-8000-0000000000d3",
      );
      assert.deepEqual(await phoneProblems(page, `/resources/${slug}`), []);
      assert.deepEqual(
        [...errors, ...messages].filter((m) => HYDRATION.test(m)),
        [],
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  } finally {
    recordedGuide = null;
  }
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

// WEB-001: "both journeys are reachable within one deliberate action".
test("a page with nothing to list still offers 'Create a document', and its link leads through sign-up with that choice, as the landing page's does", async () => {
  const page = async (path: string) => {
    const html = await (await fetch(web.origin + path)).text();
    return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  };
  const createLinks = (main: string) =>
    [...main.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
      .filter((found) => text(found[2]!) === "Create a document")
      .map((found) => found[1]!.replace(/&amp;/g, "&"));
  catalogueItems = [];
  noGuidance = true;
  try {
    // An industry with no template yet, the guides page with no guide yet, and an empty search.
    const industryPage = await page(`/industries/${industry.slug}`);
    assert.match(industryPage, /No templates for this industry yet/);
    assert.deepEqual(createLinks(industryPage), ["/sign-up?start=document"]);
    const guides = await page("/resources");
    assert.match(guides, /Need a document instead\?/);
    assert.deepEqual(createLinks(guides), ["/sign-up?start=document"]);
    const library = await page("/library");
    assert.match(library, /Nothing is published yet/);
    assert.deepEqual(createLinks(library), ["/sign-up?start=document"]);
  } finally {
    catalogueItems = null;
    noGuidance = false;
  }
});

// The redesign's word list (docs/architecture/frontend-redesign.md, "Words").
test("no public page shows one of the project's own words that the word list replaced, or an industry by its address name", async () => {
  const problems: string[] = [];
  for (const path of PAGES) {
    const html = await (await fetch(web.origin + path)).text();
    // What a visitor reads: the page's body without the data its scripts carry.
    const shown = text(
      html
        .slice(html.indexOf("<body"), html.indexOf("</body>"))
        .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/g, " "),
    );
    assert.ok(shown.includes(HEADINGS[path]!), `${path} was read`);
    for (const found of oldWordsIn(shown)) problems.push(`${path}: ${found}`);
    // An industry is named as it is written ("Retail and wholesale"), never by its address name.
    for (const each of industries)
      if (each.slug !== each.title && new RegExp(`(^|[^/\\w-])${each.slug}([^\\w-]|$)`).test(shown))
        problems.push(`${path}: shows the industry's address name "${each.slug}"`);
  }
  assert.deepEqual(problems, []);
});

// Help is for a visitor with a task in mind: the questions are grouped by task, each answer gives
// the steps, and each is true of this build.
test("the help page groups its questions by task and answers what a visitor asks first, in the server's HTML", async () => {
  const html = await (await fetch(web.origin + "/help")).text();
  const main = html.slice(html.search(/<main/), html.indexOf("</main>"));
  assert.deepEqual(
    [...main.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((heading) => heading[1]),
    [
      "Making a document",
      "Checking your requirements",
      "Dates and reminders",
      "Your account and your data",
      "Getting help",
    ],
  );
  // Fourteen questions, numbered in the order they are read.
  assert.deepEqual(
    [...main.matchAll(/data-testid="faq-(\d+)"/g)].map((question) => Number(question[1])),
    Array.from({ length: 14 }, (_, number) => number),
  );
  const words = text(main).replace(/\s+/g, " ");
  for (const sentence of [
    // How to start, in steps.
    'Sign in and choose "New document". Pick one of the twelve everyday documents',
    // The check needs no account, and an empty result is not an exemption.
    "You do not need an account.",
    "Where no published rule covers your answers, the page says so. That does not mean you are exempt.",
    "It does not provide legal, tax or accounting advice, and no regulator endorses it.",
    // The clock every date and time is on.
    "Lagos time, wherever you are.",
    // What is not sent yet.
    "Valo does not send reminder emails to customers yet.",
    "Your requests are listed under the form, each with any reply from staff. Valo does not email replies yet.",
  ])
    assert.ok(words.includes(sentence), `the help page says: ${sentence}`);
  // An answer links to the page it sends the visitor to.
  for (const [label, href] of [
    ["Check requirements", "/checker"],
    ["Report a problem", "/support"],
    ["Trouble signing in", "/account-access"],
  ] as const)
    assert.match(main, new RegExp(`<a[^>]*href="${href}"[^>]*>${label}</a>`), `${label} is a link`);
  // No price is set, so the page names none.
  assert.doesNotMatch(words, /\bfree\b|₦|\bprices?\b/i);
});

// PRV-001: "the privacy notice reflects actual production processing and optional consent is not
// bundled with required service terms"; PRO-002: "the user can decline marketing and still use the
// product". The notice is made from the processing inventory (docs/architecture/processing-inventory.md).
test("the privacy page shows each activity of the processing inventory, what the service needs apart from what a visitor may choose, says it is a draft and gives its version, in the server's HTML", async () => {
  const html = await (await fetch(web.origin + "/privacy")).text();
  const main = html.slice(html.search(/<main/), html.indexOf("</main>"));
  const at = (id: string) => {
    const found = main.indexOf(`data-testid="${id}"`);
    assert.ok(found > 0, id);
    return found;
  };
  const entries = (part: string) =>
    [...part.matchAll(/data-testid="privacy-entry-([a-z_]+)"/g)].map((m) => m[1]);
  // What the service needs, then what a visitor may choose, marketing among the choices.
  assert.deepEqual(
    entries(main.slice(at("privacy-needed"), at("privacy-optional"))),
    processingInventory.filter((activity) => activity.basis !== "consent").map((activity) => activity.id),
  );
  assert.deepEqual(entries(main.slice(at("privacy-optional"), at("privacy-services"))), [
    ...processingInventory.filter((activity) => activity.basis === "consent").map((activity) => activity.id),
    "marketing",
  ]);
  const notice = privacyNotice();
  const words = text(main).replace(/\s+/g, " ");
  for (const activity of processingInventory)
    for (const said of [activity.title, activity.purpose, activity.retention, ...activity.data])
      assert.ok(words.includes(said), `${activity.id}: ${said}`);
  for (const said of [
    notice.draft,
    `Version ${notice.version.slice(0, 12)}`,
    notice.optional.intro,
    notice.optional.marketing.text,
    notice.services.unverified,
    ...notice.services.items,
  ])
    assert.ok(words.includes(said), said);
  // Where a visitor downloads, corrects or deletes their data, or asks without signing in.
  for (const [label, href] of [
    ["Privacy and data", "/workspace/privacy"],
    ["Trouble signing in", "/account-access"],
  ] as const)
    assert.match(main, new RegExp(`<a[^>]*href="${href}"[^>]*>${label}</a>`), `${label} is a link`);
  assert.match(main, /<a[^>]*href="\/contact"[^>]*>Contact us/);
});

// PRV-001: the privacy notice is linked where data is collected (docs/architecture/processing-inventory.md,
// slice 3b). The contact form is written without an account, so its link is in the server's HTML.
test("the contact form links what Valo does with your data before a message is saved, in the server's HTML", async () => {
  const html = await (await fetch(web.origin + "/contact")).text();
  const main = html.slice(html.search(/<main/), html.indexOf("</main>"));
  const form = main.slice(main.indexOf('data-testid="form-access-support"'), main.indexOf("</form>"));
  assert.ok(form.length > 0, "the contact form is in the server's HTML");
  const link = form.match(/<a\b[^>]*data-testid="link-access-privacy"[^>]*>([^<]*)<\/a>/);
  assert.ok(link, "the form links the notice");
  assert.match(link[0], /href="\/privacy"/);
  assert.equal(link[1], "what Valo does with your data");
});

// The specification's 2026 update (docs/specification/essential-business-documents.txt): "The
// Nigeria Revenue Service has replaced the former FIRS framework, and the new Tax ID replaces the
// previous TIN identifier." Its source S02 is on www.nrs.gov.ng. The page named the earlier body and
// the earlier number.
test("the guidance page names the tax authority and its number as the specification does, says what each replaced, and gives every official source a link of its own", async () => {
  const html = await (await fetch(web.origin + "/compliance")).text();
  // The page's own notice is an aside too: the list is the one that opens with these words.
  const opens = /<p class="eyebrow">Official sources<\/p>/;
  const from = html.search(opens);
  assert.ok(from > 0, "the list of official sources is in the server's HTML");
  const aside = html.slice(from, html.indexOf("</aside>", from));
  const sources = linksIn(html, opens, "</aside>");
  assert.deepEqual(
    sources.map((source) => source.href),
    [
      "https://www.cac.gov.ng",
      "https://www.nrs.gov.ng",
      "https://ndpc.gov.ng",
      "https://smedan.gov.ng",
      "https://son.gov.ng",
      "https://www.nafdac.gov.ng",
    ],
  );
  // The authority by its present name, with its number by its present name.
  const tax = /<a\b[^>]*href="https:\/\/www\.nrs\.gov\.ng"[^>]*>([\s\S]*?)<\/a>/.exec(aside)?.[1] ?? "";
  assert.deepEqual(
    [...tax.matchAll(/<span class="block[^"]*">([^<]*)<\/span>/g)].map((line) => text(line[1]!)),
    [
      "Nigeria Revenue Service",
      "Federal taxes and the Tax ID",
      // Someone who knows the earlier names finds them here.
      "It has replaced the Federal Inland Revenue Service (FIRS), and the Tax ID replaces the TIN.",
    ],
  );
  // The earlier body is not offered as an authority, and its address is not linked.
  const words = text(aside).replace(/\s+/g, " ");
  assert.doesNotMatch(words, /Federal taxes and TIN/);
  assert.doesNotMatch(aside, /firs\.gov\.ng/);
  // Still links, not endorsements.
  assert.ok(
    words.includes("These are links, not endorsements, and none of these bodies has reviewed Valo."),
    "the page says the links are not endorsements",
  );
  // Two of the names begin with the same word: each link has a name of its own for a test.
  const ids = [...aside.matchAll(/data-testid="(link-source-[^"]*)"/g)].map((link) => link[1]);
  assert.deepEqual(ids, [
    "link-source-cac",
    "link-source-nrs",
    "link-source-ndpc",
    "link-source-smedan",
    "link-source-son",
    "link-source-nafdac",
  ]);
});

// The banner is the first thing on every page. It said "synthetic test details", the project's own
// word; the rest of the site says "made-up details".
test("a server-rendered page's banner tells a visitor to use made-up details, and the documents and guides pages describe themselves in the site's words", async () => {
  const home = await (await fetch(web.origin + "/")).text();
  const banner = text(/data-testid="text-dev-banner"[^>]*>([\s\S]*?)<\/div>/.exec(home)?.[1] ?? "").replace(
    /\s+/g,
    " ",
  );
  assert.ok(
    banner.includes("Not launched. Use made-up details only — no real customer or confidential data."),
    banner,
  );
  assert.ok(banner.includes("Developer notes"), banner);
  assert.doesNotMatch(banner, /synthetic/i);
  // A page's description is what a search result or a shared link shows of it.
  for (const [path, description] of [
    [
      "/library",
      "Search the business templates and guidance Valo has published, by keyword, category, industry and access level.",
    ],
    [
      "/resources",
      "Browse the business guidance Valo has published, with its sources and the dates they were checked.",
    ],
  ] as const) {
    const html = await (await fetch(web.origin + path)).text();
    assert.equal(/<meta name="description" content="([^"]*)"\/>/.exec(html)?.[1], description, path);
  }
});

// DOC-004: a premium template's text is the buyer's alone. No file the web app's build serves, its
// pages or its scripts, holds any of it; a page shows only its public description.
test("no file the web app's build serves holds a sentence of any premium template's text", async () => {
  const build = resolve(import.meta.dirname, "../../../valo/.next");
  const served: string[] = [];
  for (const folder of ["server", "static"])
    for (const name of await readdir(resolve(build, folder), { recursive: true }))
      served.push(resolve(build, folder, name));
  // Each file's text, its whitespace and escaped line breaks read as single spaces.
  const texts: string[] = [];
  for (const path of served) {
    const text = await readFile(path, "utf8").catch(() => null);
    if (text !== null) texts.push(text.replace(/\\n|\s+/g, " "));
  }
  const all = texts.join("\n");
  assert.ok(texts.length > 50, `the build holds only ${texts.length} readable files`);
  // The scan reads the scripts: a question's label, which the workspace's scripts carry, is found.
  assert.ok(all.includes(GUIDED_SPECS_V1["TPL-01"].fields[0]!.label), "a bundled question's label");
  const premium = baselineTemplates.filter((template) => template.access === "premium");
  assert.ok(premium.length >= 28);
  const found: string[] = [];
  for (const template of premium) {
    const { section } = await readTemplateIntake(template.id);
    // Plain sentences of the text, which a script would carry as they are.
    const sentences = section.body
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.replace(/\s+/g, " ").trim())
      .filter((sentence) => sentence.length >= 60 && /^[A-Za-z0-9 ,.;:()-]+$/.test(sentence));
    assert.ok(sentences.length > 0, `${template.id} has sentences to look for`);
    for (const sentence of sentences) if (all.includes(sentence)) found.push(`${template.id}: ${sentence}`);
  }
  assert.deepEqual(found, []);
});
