import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import { paginateReleasedItems, type ReleasedLibraryItem } from "../modules/catalogue/valo-catalogue";
import { menuProblems, phoneProblems, ready } from "../test-support/app-in-browser";
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
/** While a test sets it, the API no longer lists the first released template and guidance entry, as
 * after their withdrawal: the lists and discovery leave them out, and reading either is not found. */
let withdrawn = false;
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
  "/privacy": "How this build handles data",
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

test("the home page offers both actions in its hero, beside its tasks and at its end, lists its eight everyday tasks, labels its examples as made up, shows the template count the server read and uses no price words", async () => {
  const html = await (await fetch(web.origin + "/")).text();
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const link = (testId: string) => {
    const found = new RegExp(`<a\\b[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</a>`).exec(main);
    return found && { href: /href="([^"]*)"/.exec(found[0])?.[1], label: text(found[1]!) };
  };
  // Documents and requirements side by side, in the same words, wherever the page offers an action.
  for (const place of ["hero", "closing"]) {
    assert.deepEqual(link(`link-${place}-documents`), { href: "/sign-up", label: "Create a document" });
    assert.deepEqual(link(`link-${place}-compliance`), { href: "/checker", label: "Check my requirements" });
  }
  assert.deepEqual(link("link-tasks-compliance"), { href: "/checker", label: "Check my requirements" });

  const tasks = linksIn(main, /<ul[^>]*data-testid="list-tasks"/, "</ul>");
  assert.deepEqual(
    tasks.map((task) => task.href),
    HOME_TASKS.map(() => "/sign-up"),
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
