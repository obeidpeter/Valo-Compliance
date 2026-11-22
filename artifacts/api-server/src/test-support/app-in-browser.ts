import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { chromium, devices, type BrowserContextOptions, type Page, type Route } from "playwright";
import axe from "axe-core";

/**
 * The real web app in a browser, for checks that need it signed in or signed out. The compiled app
 * cannot sign in here: the identity provider's script cannot load in a test. So the app is bundled
 * with a stand-in for the identity library, and everything else is the app's own code, from its
 * routes and account boundary to each screen, styled with its compiled CSS and fonts. Build the web
 * app first: `pnpm --filter @workspace/valo run build`.
 */
const front = resolve(import.meta.dirname, "../../../valo");
export const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// The real app with nothing around it, as the browser runs it.
const fixture = `
import { createRoot } from "react-dom/client";
import App from "@/App";
createRoot(document.getElementById("root")).render(<App />);
`;

// The identity library as it reports one signed-in synthetic account, or a signed-out visitor, once
// it has loaded. The provider's own sign-in, sign-up and account widgets are not drawn.
const identities = {
  "signed-in": `
import { createContext, createElement, useContext } from "react";
const ProfileAppearance = createContext({});
const user = {
  id: "user_synthetic_accessibility",
  firstName: "Synthetic",
  primaryEmailAddress: {
    emailAddress: "synthetic-accessibility@example.test",
    verification: { status: "verified" },
  },
};
export function ClerkProvider({ children, appearance }) {
  return createElement(ProfileAppearance.Provider, { value: appearance.elements }, children);
}
export function Show({ when, children }) { return when === "signed-in" ? children : null; }
export function useAuth() {
  return { isLoaded: true, isSignedIn: true, userId: user.id, sessionId: "sess_synthetic_accessibility" };
}
export function useUser() { return { isLoaded: true, isSignedIn: true, user }; }
export function useClerk() { return { signOut() {} }; }
export function useReverification(action) { return action; }
export function SignIn() { return null; }
export function SignUp() { return null; }
export function UserProfile() {
  const { rootBox, cardBox } = useContext(ProfileAppearance);
  return createElement("div", { className: "cl-userProfile-root cl-rootBox " + rootBox },
    createElement("div", { className: "cl-cardBox " + cardBox },
      createElement("div", { className: "cl-scrollBox" },
        createElement("p", null, "The identity provider's account settings, not drawn in this test."))));
}
`,
  "signed-out": `
import { createElement } from "react";
export function ClerkProvider({ children }) { return children; }
export function Show({ when, children }) { return when === "signed-out" ? children : null; }
export function useAuth() { return { isLoaded: true, isSignedIn: false, userId: null, sessionId: null }; }
export function useUser() { return { isLoaded: true, isSignedIn: false, user: null }; }
export function useClerk() { return { signOut() {} }; }
export function useReverification(action) { return action; }
// The provider's sign-in and sign-up cards open with these headings (the app's localisation). The
// card shows what the app hands the provider: where to go afterwards, and the other form's address.
const card = (heading, form, props) =>
  createElement(
    "div",
    {
      "data-testid": "identity-card",
      "data-after": props.forceRedirectUrl ?? "",
      "data-other-form": props.signInUrl ?? props.signUpUrl ?? "",
    },
    createElement("h1", null, heading),
    createElement("p", null, form),
  );
export function SignIn(props) {
  return card("Sign in to Valo", "The identity provider's sign-in form, not drawn in this test.", props);
}
export function SignUp(props) {
  return card("Create your account", "The identity provider's sign-up form, not drawn in this test.", props);
}
export function UserProfile() { return null; }
`,
} as const;
const library: Record<string, string> = {
  "@clerk/react/internal": `export function publishableKeyFromHost() { return "pk_test_synthetic"; }`,
  "@clerk/react/errors": `export function isReverificationCancelledError() { return false; }`,
  "@clerk/themes": `export const shadcn = {};`,
};

/** Answers one API request the page makes; it throws when it has no answer. */
export type Api = (route: Route, method: string, path: string, query: URLSearchParams) => Promise<void>;

/** Serves the app with the stand-in identity, and opens its pages on an emulated phone. */
export async function startApp(account: keyof typeof identities) {
  const modules: Record<string, string> = { ...library, "@clerk/react": identities[account] };
  const bundle = await build({
    stdin: { contents: fixture, loader: "tsx", resolveDir: front },
    absWorkingDir: front,
    bundle: true,
    write: false,
    outdir: "app-in-browser-fixture",
    format: "iife",
    jsx: "automatic",
    alias: { "@": resolve(front, "src") },
    define: { "process.env": "{}" },
    logLevel: "silent",
    plugins: [
      {
        name: "identity-stand-in-only-in-tests",
        setup(b) {
          b.onResolve({ filter: /^@clerk\// }, (args) => {
            assert.ok(modules[args.path], `no stand-in for ${args.path}`);
            return { path: args.path, namespace: "identity" };
          });
          b.onLoad({ filter: /.*/, namespace: "identity" }, (args) => ({
            contents: modules[args.path]!,
            loader: "js",
            resolveDir: front,
          }));
        },
      },
    ],
  });
  const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.contents;
  // The compiled app's own CSS and the fonts it names.
  const staticFolder = resolve(front, ".next/static");
  const cssFiles = (
    await readdir(resolve(staticFolder, "css"), { recursive: true }).catch(() => [] as string[])
  ).filter((path) => path.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "build the web app first: pnpm --filter @workspace/valo run build");
  const css = (
    await Promise.all(cssFiles.map((path) => readFile(resolve(staticFolder, "css", path), "utf8")))
  ).join("\n");
  const types: Record<string, string> = {
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".svg": "image/svg+xml",
  };
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://fixture.invalid").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (path === "/fixture.js") res.setHeader("Content-Type", "text/javascript").end(script);
    else if (path === "/fixture.css") res.setHeader("Content-Type", "text/css").end(css);
    else if (path.startsWith("/_next/static/")) {
      const file = resolve(staticFolder, decodeURIComponent(path.slice("/_next/static/".length)));
      if (!file.startsWith(staticFolder + sep)) res.writeHead(404).end();
      else
        readFile(file).then(
          (bytes) =>
            res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream").end(bytes),
          () => res.writeHead(404).end(),
        );
    } else if (path.startsWith("/api/")) res.writeHead(404).end();
    else
      // The title Next gives every private page.
      res
        .setHeader("Content-Type", "text/html")
        .end(
          '<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page unavailable or private — Valo</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
        );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"],
  });

  /** A page in a browser context of its own, whose API calls `api` answers; any other host is
   * unreachable. */
  async function open(path: string, api: Api, options: BrowserContextOptions) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const unknown: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(`${origin}/api/**`, (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        apiPath = url.pathname.replace(/^\/api/, "");
      return api(route, request.method(), apiPath, url.searchParams).catch((error: unknown) => {
        unknown.push(`${request.method()} ${apiPath}: ${String(error)}`);
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: '{"error":"No test answer"}',
        });
      });
    });
    await page.route(
      (url) => url.origin !== origin,
      (route) => route.abort(),
    );
    await page.goto(origin + path, { waitUntil: "load" });
    return { page, unknown, errors, close: () => context.close() };
  }

  return {
    origin,
    /** A phone-sized page (Moto G4). */
    phone: (path: string, api: Api) => open(path, api, { ...devices["Moto G4"] }),
    /** A page as wide as a desktop screen, where the app lays itself out in full. */
    desktop: (path: string, api: Api) => open(path, api, { viewport: { width: 1440, height: 900 } }),
    async close() {
      await browser.close();
      server.close();
    },
  };
}

/** Waits until the fonts have loaded, no placeholder is loading and the entrance animations have
 * finished, so text is measured in the fonts customers see. */
export async function settled(page: Page) {
  await page.evaluate("document.fonts.ready.then(() => document.fonts.status)");
  for (let poll = 0; poll < 100; poll++) {
    const busy = await page.evaluate(
      `document.querySelectorAll('[aria-busy="true"], .animate-pulse').length === 0 &&
       document.getAnimations().every((a) => a.playState !== "running")`,
    );
    if (busy) return;
    await delay(100);
  }
  throw Error("the page kept loading");
}

/** Waits for the screen's own content, then until it has settled. */
export async function ready(page: Page) {
  await page.locator("main h1").first().waitFor({ state: "visible", timeout: 30_000 });
  await settled(page);
}

/** Waits until the page has stopped scrolling. The site scrolls smoothly, so after keyboard focus
 * moves the page is still on its way for a moment, and what is measured meanwhile is true of no one
 * place: a small control passing under the phone's bar reads as a target too small to tap. */
export async function atRest(page: Page) {
  let last = Number.NaN,
    still = 0;
  for (let poll = 0; poll < 100 && still < 3; poll++) {
    const at = await page.evaluate<number>("window.scrollY");
    still = at === last ? still + 1 : 0;
    last = at;
    await delay(100);
  }
  if (still < 3) throw Error("the page kept scrolling");
}

/** The axe-core WCAG A and AA rules that fail on the page, once it is at rest. */
export async function wcagFailures(page: Page) {
  await atRest(page);
  if (!(await page.evaluate("typeof window.axe !== 'undefined'")))
    await page.addScriptTag({ content: axe.source });
  return (await page.evaluate(
    `axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(WCAG)} } })
      .then((r) => ({ passes: r.passes.length, failures: r.violations.map((v) => v.id + " (" + v.impact + "): " + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")) }))`,
  )) as { passes: number; failures: string[] };
}

/** The deepest elements that reach past the right edge of the screen, for a failure message. A
 * phone widens its layout viewport to fit an overflowing page, so the edge is the screen's own width. */
export async function overflowing(page: Page): Promise<string> {
  const edge = page.viewportSize()!.width;
  return page.evaluate<string>(`(() => {
    const out = [];
    for (const e of document.querySelectorAll("body *")) {
      if (e.getBoundingClientRect().right <= ${edge} || getComputedStyle(e).position === "fixed") continue;
      // Inside a container that scrolls or clips, it cannot widen the page.
      let clipped = false;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement)
        if (getComputedStyle(a).overflowX !== "visible") clipped = true;
      if (!clipped) out.push(e);
    }
    return out
      .filter((e) => !out.some((other) => other !== e && e.contains(other)))
      .slice(0, 3)
      .map((e) => e.tagName.toLowerCase() + " '" + (e.textContent || "").trim().slice(0, 40) + "'")
      .join(", ");
  })()`);
}

export type Stop = {
  name: string;
  visible: boolean;
  outlined: boolean;
  covered: boolean;
  offScreen: boolean;
};

/** What the keyboard has just focused, or null once focus has left the page or come round to an
 * element already visited. `covered` is whether a bar that stays on screen (anything fixed or sticky
 * that the element is not part of, such as the site's header or the phone's bottom bar) lies over
 * the element's middle, or over its top or bottom edge when the element is short enough to fit
 * clear of the bars. `offScreen` is whether the element is outside the screen, which no bar need
 * cover: a menu longer than the screen, inside a header that stays put, leaves its last links there.
 * A short element is outside when its middle is; one too tall to fit, when no part of it shows. */
const FOCUSED = `(() => {
  const e = document.activeElement;
  if (!e || e === document.body || window.tabbed.has(e)) return null;
  window.tabbed.add(e);
  const s = getComputedStyle(e), box = e.getBoundingClientRect();
  const under = (x, y) => {
    for (let over = document.elementFromPoint(x, y); over && over !== document.body; over = over.parentElement)
      if (["fixed", "sticky"].includes(getComputedStyle(over).position) && !over.contains(e)) return true;
    return false;
  };
  const x = box.left + box.width / 2, y = box.top + box.height / 2, short = box.height < innerHeight / 2;
  return { name: e.tagName + " " + (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40),
    visible: box.width > 0 && box.height > 0 && s.visibility === "visible",
    outlined: (s.outlineStyle !== "none" && s.outlineWidth !== "0px") || s.boxShadow !== "none",
    covered: under(x, y) || (short && (under(x, box.top + 1) || under(x, box.bottom - 1))),
    offScreen: box.right <= 0 || box.left >= innerWidth ||
      (short ? y < 0 || y > innerHeight : box.bottom <= 0 || box.top >= innerHeight) };
})()`;

/**
 * Each element the keyboard reaches, once round the page with Tab, or back round it with Shift+Tab:
 * whether it is visible, outlined, and clear of the bars that stay on screen. Going forward an
 * element scrolls in at the bottom, by the phone's bar; going back, at the top, by the header.
 *
 * The round runs with motion reduced, which turns the site's smooth scrolling off, so each element
 * is measured where it comes to rest and not on its way there. The page stays that way afterwards.
 */
export async function tabbing(page: Page, key: "Tab" | "Shift+Tab" = "Tab") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const stops: Stop[] = [];
  await page.evaluate("window.tabbed = new WeakSet()");
  for (let step = 0; step < 80; step++) {
    await page.keyboard.press(key);
    const focus = (await page.evaluate(FOCUSED)) as Stop | null;
    if (!focus) break;
    stops.push(focus);
  }
  return stops;
}

/** The layout, keyboard and axe-core problems on a page that is ready, at 360 and then 320 pixels wide.
 * Tab must reach at least `minimumStops` elements, which shows the keyboard check ran. */
export async function phoneProblems(page: Page, path: string, { minimumStops = 3 } = {}) {
  const problems: string[] = [];
  const width = await page.evaluate<number>("document.documentElement.scrollWidth");
  if (width !== 360)
    problems.push(`${path}: ${width} pixels wide on a 360-pixel screen (${await overflowing(page)})`);
  const stops = await tabbing(page);
  if (stops.length < minimumStops) problems.push(`${path}: Tab reached only ${stops.length} elements`);
  for (const [i, stop] of stops.entries()) {
    if (!stop.visible) problems.push(`${path}: Tab ${i + 1} focused a hidden element (${stop.name})`);
    else if (!stop.outlined)
      problems.push(`${path}: Tab ${i + 1} focus on ${stop.name} has no visible outline`);
    else if (stop.offScreen) problems.push(`${path}: Tab ${i + 1} left ${stop.name} off the screen`);
    else if (stop.covered)
      problems.push(`${path}: Tab ${i + 1} left ${stop.name} behind a bar that stays on screen`);
  }
  for (const [i, stop] of (await tabbing(page, "Shift+Tab")).entries())
    if (stop.visible && stop.offScreen)
      problems.push(`${path}: Shift+Tab ${i + 1} left ${stop.name} off the screen`);
    else if (stop.visible && stop.covered)
      problems.push(`${path}: Shift+Tab ${i + 1} left ${stop.name} behind a bar that stays on screen`);
  const { passes, failures } = await wcagFailures(page);
  if (passes <= 10) problems.push(`${path}: axe ran only ${passes} passing rules`);
  problems.push(...failures.map((failure) => `${path}: ${failure}`));
  await page.setViewportSize({ width: 320, height: 640 });
  await delay(300);
  const narrow = await page.evaluate<number>("document.documentElement.scrollWidth");
  if (narrow > 320)
    problems.push(`${path}: ${narrow} pixels wide on a 320-pixel screen (${await overflowing(page)})`);
  return problems;
}

/** The screens the phone's opened menu must fit: the test phone upright, a shorter and narrower
 * phone, and a phone on its side, where the header and the bottom bar leave the menu little room. */
const MENU_SCREENS = [
  { width: 360, height: 640 },
  { width: 320, height: 480 },
  { width: 640, height: 360 },
];

/**
 * The problems with the phone's opened menu on each of those screens: a control in it that keyboard
 * focus leaves off the screen or behind a bar that stays on screen. The header stays put, so a
 * finger cannot scroll to such a control either. On each screen it opens the menu from the keyboard,
 * goes through the header with Tab, and closes the menu again with Escape, which must return focus
 * to its button. The page is left at the last of the sizes.
 */
export async function menuProblems(page: Page, path: string, { minimumStops = 3 } = {}) {
  const problems: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const size of MENU_SCREENS) {
    await page.setViewportSize(size);
    await delay(300);
    problems.push(
      ...(await openMenuProblems(page, `${path} at ${size.width} by ${size.height}`, minimumStops)),
    );
  }
  return problems;
}

async function openMenuProblems(page: Page, where: string, minimumStops: number) {
  const problems: string[] = [];
  const button = page.getByTestId("button-menu");
  await button.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("navigation", { name: "Mobile" }).waitFor({ state: "visible" });
  await page.evaluate("window.tabbed = new WeakSet()");
  let stops = 0;
  for (let step = 0; step < 40; step++) {
    await page.keyboard.press("Tab");
    if (!(await page.evaluate("!!document.activeElement?.closest('header')"))) break;
    const stop = (await page.evaluate(FOCUSED)) as Stop | null;
    if (!stop) break;
    stops++;
    if (!stop.visible) problems.push(`${where}: the open menu's ${stop.name} is hidden`);
    else if (stop.offScreen) problems.push(`${where}: the open menu leaves ${stop.name} off the screen`);
    else if (stop.covered)
      problems.push(`${where}: the open menu leaves ${stop.name} behind a bar that stays on screen`);
  }
  if (stops < minimumStops) problems.push(`${where}: Tab reached only ${stops} controls in the open menu`);
  await button.focus();
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Mobile" }).waitFor({ state: "hidden" });
  if ((await page.evaluate("document.activeElement?.getAttribute('data-testid')")) !== "button-menu")
    problems.push(`${where}: Escape did not return focus to the menu button`);
  return problems;
}
