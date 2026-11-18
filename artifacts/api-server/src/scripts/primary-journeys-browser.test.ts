import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, devices, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { GetBuildStatusResponse } from "@workspace/api-zod";

/**
 * WEB-001: "The homepage and primary navigation must give documents and compliance guidance
 * comparable visibility", accepted with "both journeys are reachable within one deliberate action
 * from the hero and mobile menu."
 *
 * The real home screen inside the real site shell, styled with the compiled web app's CSS, on an
 * emulated phone. The compiled app cannot show its home page here: the page waits for the identity
 * provider's script, which cannot load in a test. So the two components are bundled with a
 * stand-in for the identity library that reports a signed-out visitor, the person the hero is for.
 * Other pages render as their path, which is enough to show where a tap led. The API is answered
 * with synthetic data the contract's schema accepts.
 */
const front = resolve(import.meta.dirname, "../../../valo");
const unknownApiPaths = new Set<string>();
let server: Server | undefined;
let browser: Browser | undefined;
let origin = "";

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch, useLocation } from "wouter";
import { SiteShell } from "@/components/site-shell";
import Home from "@/screens/home";
function Elsewhere() {
  const [location] = useLocation();
  return <h1 data-testid="text-opened-path">{location}</h1>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <Router>
      <SiteShell>
        <Switch>
          <Route path="/" component={Home} />
          <Route component={Elsewhere} />
        </Switch>
      </SiteShell>
    </Router>
  </QueryClientProvider>,
);
`;

// A signed-out visitor, as the identity library reports one once it has loaded.
const signedOutIdentity = `
export function Show({ when, children }) { return when === "signed-out" ? children : null; }
export function useUser() { return { isLoaded: true, isSignedIn: false, user: null }; }
export function useClerk() { return { signOut() {} }; }
`;

before(async () => {
  const bundle = await build({
    stdin: { contents: fixture, loader: "tsx", resolveDir: front },
    absWorkingDir: front,
    bundle: true,
    write: false,
    outdir: "primary-journeys-fixture",
    format: "iife",
    jsx: "automatic",
    alias: { "@": resolve(front, "src") },
    define: { "process.env": "{}" },
    logLevel: "silent",
    plugins: [
      {
        name: "signed-out-identity-only-in-this-test",
        setup(b) {
          b.onResolve({ filter: /^@clerk\/react$/ }, () => ({ path: "identity", namespace: "identity" }));
          b.onLoad({ filter: /.*/, namespace: "identity" }, () => ({
            contents: signedOutIdentity,
            loader: "js",
          }));
        },
      },
    ],
  });
  const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.contents;
  // The compiled app's own CSS, so the phone layout (the hidden header links, the menu button and
  // the bottom dock) is the one customers get.
  const cssFolder = resolve(front, ".next/static/css");
  const cssFiles = (await readdir(cssFolder, { recursive: true }).catch(() => [] as string[])).filter(
    (path) => path.endsWith(".css"),
  );
  assert.ok(cssFiles.length > 0, "build the web app first: pnpm --filter @workspace/valo run build");
  const css = (await Promise.all(cssFiles.map((path) => readFile(resolve(cssFolder, path), "utf8")))).join(
    "\n",
  );
  const status = JSON.stringify(
    GetBuildStatusResponse.parse({
      receivedRequirements: 127,
      expectedRequirements: 127,
      publishedTemplates: 0,
      p0Passed: false,
      r2Unlocked: false,
      livePaymentsEnabled: false,
      notice: "Synthetic test fixture.",
    }),
  );
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://fixture.invalid").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (path === "/fixture.js") res.setHeader("Content-Type", "text/javascript").end(script);
    else if (path === "/fixture.css") res.setHeader("Content-Type", "text/css").end(css);
    else if (path === "/api/public/status") res.setHeader("Content-Type", "application/json").end(status);
    else if (path.startsWith("/api/")) {
      unknownApiPaths.add(path);
      res.writeHead(404).end();
    } else if (path.startsWith("/_next/"))
      res.writeHead(404).end(); // The compiled CSS's font files.
    else
      res
        .setHeader("Content-Type", "text/html")
        .end(
          '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>',
        );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"],
  });
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** Opens the home page on a fresh emulated phone and runs the checks, then fails on any page error. */
async function onPhoneHome(checks: (page: Page) => Promise<void>) {
  const context = await browser!.newContext({ ...devices["Moto G4"] });
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/");
    await expect(page.getByTestId("text-headline")).toBeVisible();
    await checks(page);
  } finally {
    await context.close();
  }
  assert.deepEqual(errors, [], "the page reported no error");
  assert.deepEqual([...unknownApiPaths], [], "every API call the page made has a test answer");
}

/** One tap on the link opens the page at this path. */
async function tapOpens(page: Page, link: Locator, path: string) {
  await link.tap();
  await expect(page).toHaveURL(origin + path);
  await expect(page.getByTestId("text-opened-path")).toHaveText(path);
}

test("on a phone, the home page's hero links to both journeys, and one tap on either opens it", () =>
  onPhoneHome(async (page) => {
    const documents = page.getByTestId("link-hero-documents");
    const compliance = page.getByTestId("link-hero-compliance");
    await expect(documents).toHaveText("Start a business draft");
    await expect(documents).toHaveAttribute("href", "/sign-up");
    await expect(compliance).toHaveText("Check what may apply");
    await expect(compliance).toHaveAttribute("href", "/checker");
    // Both shelves, documents first, are laid out the same way.
    await expect(page.getByTestId("card-shelf-documents")).toBeVisible();
    await expect(page.getByTestId("card-shelf-compliance")).toBeVisible();
    // The page fits a 360-pixel-wide screen without scrolling sideways.
    assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 360);

    await tapOpens(page, documents, "/sign-up");
    await page.goBack();
    await tapOpens(page, compliance, "/checker");
  }));

test("on a phone, the opened mobile menu and the bottom dock each link to both journeys, and one tap on any of them opens it", () =>
  onPhoneHome(async (page) => {
    // At phone width the header's own links are hidden, so the menu carries the navigation.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    const menu = page.getByRole("navigation", { name: "Mobile" });
    const openMenu = async () => {
      await page.getByRole("button", { name: "Open menu" }).tap();
      await expect(menu).toBeVisible();
    };
    await openMenu();
    // The menu's panel: its navigation, then the sign-in and workspace buttons.
    const panel = menu.locator("..");
    const menuLinks = [
      [panel.getByRole("link", { name: "Library", exact: true }), "/library"],
      [panel.getByRole("link", { name: "Checker", exact: true }), "/checker"],
      [panel.getByRole("link", { name: "Open a workspace", exact: true }), "/sign-up"],
    ] as const;
    for (const [link, path] of menuLinks) await expect(link).toHaveAttribute("href", path);
    for (const [link, path] of menuLinks) {
      await tapOpens(page, link, path);
      // Opening a page closes the menu, so the next journey starts from a closed menu.
      await expect(menu).toBeHidden();
      await page.goBack();
      await openMenu();
    }

    // The dock stays on screen on every page, with one button for each journey.
    const documents = page.getByTestId("link-dock-documents");
    const compliance = page.getByTestId("link-dock-compliance");
    await expect(documents).toHaveText("Start a draft");
    await expect(documents).toHaveAttribute("href", "/sign-up");
    await expect(compliance).toHaveText("Check rules");
    await expect(compliance).toHaveAttribute("href", "/checker");
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await expect(documents).toBeInViewport();
    await expect(compliance).toBeInViewport();
    await tapOpens(page, compliance, "/checker");
    await page.goBack();
    await tapOpens(page, documents, "/sign-up");
  }));
