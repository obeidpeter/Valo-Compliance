import assert from "node:assert/strict";
import { chromium } from "playwright";
import { chromiumLaunchPath } from "../platform/chromium";

// Public, signed-out checks only: no database imports, credentials, or mutations.
// An iframe is essential: the development proxy injects preview scripts there.
const base = new URL(
  process.env.VALO_PREVIEW_URL ??
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : "http://127.0.0.1:80/"),
);
const browser = await chromium.launch({
  ...chromiumLaunchPath(),
  headless: true,
  args: ["--no-sandbox"],
});
let passed = 0;
try {
  for (const width of [1280, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    try {
      for (const embedded of [false, true]) {
        for (const path of ["", "library", "sign-in"]) {
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("console", (message) => {
            if (
              message.type() === "error" &&
              /hydration|uncaught|referenceerror|typeerror/i.test(message.text())
            ) {
              errors.push(message.text());
            }
          });
          try {
            const target = new URL(path, base).href;
            if (embedded) {
              const parent = new URL("__valo_hydration_test_parent", base).href;
              await page.route(parent, (route) =>
                route.fulfill({
                  contentType: "text/html",
                  body: `<!doctype html><html><head><title>Preview regression</title></head><body style="margin:0"><iframe title="Valo preview" style="width:100%;height:800px;border:0" src="${target.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe></body></html>`,
                }),
              );
              await page.goto(parent, { waitUntil: "networkidle" });
            } else {
              const response = await page.goto(target, { waitUntil: "networkidle" });
              assert.equal(response?.status(), 200);
            }
            const app = embedded ? page.frameLocator('iframe[title="Valo preview"]') : page;
            await app.getByLabel("Loading Valo", { exact: true }).waitFor({ state: "hidden" });
            await app
              .getByTestId(path === "sign-in" ? "link-auth-access-help" : "text-dev-banner")
              .waitFor({ state: "visible" });
            await page.waitForTimeout(200);
            assert.deepEqual(errors, [], `${embedded ? "iframe" : "standalone"} ${width}px /${path}`);
            console.log(`PASS ${embedded ? "iframe" : "standalone"} ${width}px /${path}`);
            passed++;
          } finally {
            await page.close();
          }
        }
      }
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ passed, failed: 0, signedInJourneysTested: false }));
} finally {
  await browser.close();
}
