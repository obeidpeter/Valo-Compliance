/** Actual UI/generated clients with controlled HTTP data, not Clerk or release acceptance. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { paginateReleasedItems } from "../modules/catalogue";
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
  import Library from ${JSON.stringify(join(root, "artifacts/valo/src/public-screens/library.tsx"))};
  import{SaveTemplateButton,SavedTemplates}from ${JSON.stringify(join(root, "artifacts/valo/src/components/saved-templates.tsx"))};
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>{location.pathname==='/fixture-saved'?<><SaveTemplateButton releaseId="11111111-1111-4111-8111-111111111111" templateId="TPL-01"/><SavedTemplates/></>:<Library/>}</QueryClientProvider>);`,
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
const rows = Array.from({ length: 23 }, (_, i) => ({
  ...template,
  id: i ? String(i) : template.id,
  title: i ? "Fixture " + i : template.title,
  slug: "fixture-" + i,
}));
let saved = false,
  available = true,
  deny = false;
const queries: string[] = [];
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
    if (url.pathname === "/api/public/coverage") {
      res.end(JSON.stringify({ industries: [{ id: "IND-01", slug: "retail", title: "Retail" }] }));
      return;
    }
    if (url.pathname === "/api/public/catalogue") {
      queries.push(url.search);
      res.end(
        JSON.stringify(
          paginateReleasedItems(rows, {
            ...Object.fromEntries(url.searchParams),
            page: Number(url.searchParams.get("page") ?? 1),
          }),
        ),
      );
      return;
    }
    if (url.pathname.startsWith("/api/workspace/saved-templates")) {
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
    '<!doctype html><html lang="en"><title>Controlled catalogue journey</title><style>body{font:16px system-ui;margin:16px}button,select,input{min-height:44px;margin:4px}a{display:inline-block}li{margin:8px 0}</style><div id="root"></div><script src="/fixture.js"></script></html>',
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
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/library");
  await page.getByTestId("text-result-count").waitFor();
  await page.getByTestId("select-category").selectOption("Finance and operations");
  await page.getByTestId("select-access").selectOption("free");
  await page.getByTestId("select-industry").selectOption("retail");
  await page.getByTestId("select-sort").selectOption("name");
  await page.reload();
  await page.getByTestId("text-result-count").waitFor();
  assert.equal(await page.getByTestId("select-category").inputValue(), "Finance and operations");
  assert.equal(await page.getByTestId("select-access").inputValue(), "free");
  assert.equal(await page.getByTestId("select-sort").inputValue(), "name");
  await page.getByTestId("button-next").click();
  await page.waitForURL(/page=2/);
  await page.waitForFunction("document.querySelectorAll('li[data-testid^=\"card-item-\"]').length===3");
  assert.equal(await page.locator('li[data-testid^="card-item-"]').count(), 3);
  checks.push("combined filters, sort and pagination persist in URL across reload");
  await page.getByTestId("input-search").fill("not-found-fixture");
  await page.getByTestId("button-search").click();
  await page.getByTestId("status-empty").waitFor();
  assert.ok(!new URL(page.url()).searchParams.has("page"));
  await page.getByTestId("button-clear-filters").click();
  await page.getByTestId("text-result-count").waitFor();
  assert.equal(new URL(page.url()).search, "");
  checks.push("query resets page; no-results suggestions and reset work");
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
        requestCount: queries.length,
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
