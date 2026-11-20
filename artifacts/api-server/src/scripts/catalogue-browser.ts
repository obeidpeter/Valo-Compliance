/**
 * Actual UI/generated clients with controlled HTTP data, not Clerk or release acceptance: the saved
 * templates button and list. The library's own filters, sort and pages are checked on the compiled
 * web server (public-server-pages.test.ts), since the server renders that page (decision 0011).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { chromiumLaunchPath } from "../platform/chromium";
assert.equal(process.env.NODE_ENV, "development");
assert.equal(process.env.VALO_RUN_CATALOGUE_BROWSER, "synthetic-development-only");
const require = createRequire(import.meta.url),
  { build } = require("esbuild") as typeof import("esbuild"),
  { chromium } = require("playwright") as typeof import("playwright");
const root = resolve(import.meta.dirname, "../../../.."),
  evidence = join(root, "generated-artifacts/valo-completion");
await mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';
  import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
  import{SaveTemplateButton,SavedTemplates}from ${JSON.stringify(join(root, "artifacts/valo/src/components/saved-templates.tsx"))};
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><SaveTemplateButton releaseId="11111111-1111-4111-8111-111111111111" templateId="TPL-01"/><SavedTemplates/></QueryClientProvider>);`,
    loader: "tsx",
    resolveDir: join(root, "artifacts/valo"),
  },
  alias: { "@": join(root, "artifacts/valo/src") },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
});
const template = {
  id: "11111111-1111-4111-8111-111111111111",
  templateId: "TPL-01",
  slug: "synthetic-invoice",
  title: "Synthetic invoice",
  type: "template",
  industry: "retail",
  category: "Finance and operations",
  access: "free" as const,
  summary: "Synthetic fixture only",
  href: "/library/synthetic-invoice",
  reviewedAt: "2026-01-01T00:00:00Z",
};
let saved = false,
  available = true,
  deny = false;
let requests = 0;
const payload = () => ({
  items: saved
    ? [
        {
          templateId: "TPL-01",
          title: template.title,
          savedVersion: 1,
          savedAt: new Date().toISOString(),
          available,
          current: available ? template : null,
        },
      ]
    : [],
  recommendations: [],
  notice: "Controlled suggestions only",
});
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture");
  if (url.pathname === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0]!.contents);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname.startsWith("/api/workspace/saved-templates")) {
      requests++;
      if (deny) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "Controlled revoked owner" }));
        return;
      }
      if (req.method === "PUT") saved = true;
      if (req.method === "DELETE") saved = false;
      res.end(JSON.stringify(payload()));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="en"><title>Controlled saved templates journey</title><style>body{font:16px system-ui;margin:16px}button,select,input{min-height:44px;margin:4px}a{display:inline-block}li{margin:8px 0}</style><div id="root"></div><script src="/fixture.js"></script></html>',
  );
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = "http://127.0.0.1:" + address.port,
  checks: string[] = [],
  errors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({
    ...chromiumLaunchPath(),
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/fixture-saved");
  const save = page.getByTestId("button-save-template");
  await save.waitFor();
  await save.click();
  await page.getByTestId("saved-TPL-01").waitFor();
  assert.equal(await save.getAttribute("aria-pressed"), "true");
  const second = await browser.newPage();
  await second.goto(origin + "/fixture-saved");
  await second.getByTestId("saved-TPL-01").waitFor();
  checks.push("actual save button/generated client updates saved state and independent page reads it");
  available = false;
  await second.reload();
  await second.getByText(/Currently unavailable/).waitFor();
  assert.equal(await second.getByTestId("saved-TPL-01").locator("a").count(), 0);
  await second.getByRole("button", { name: "Remove saved item" }).click();
  await second.getByText("Keep useful templates here").waitFor();
  checks.push("withdrawn item has no unusable link and can still be removed");
  deny = true;
  await page.reload();
  await page.getByRole("alert").first().waitFor();
  assert.equal(await page.getByTestId("button-save-template").isDisabled(), true);
  checks.push("denied owner gets error and cannot mutate from UI");
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, "catalogue-browser.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        requestCount: requests,
        scope:
          "Controlled HTTP data with actual components/generated clients. No real identity, native data, published content or visual acceptance.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors: errors.length }));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}
