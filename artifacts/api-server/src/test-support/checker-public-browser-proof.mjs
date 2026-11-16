/** Real public UI checks; deliberately cannot claim an authenticated journey. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const out = resolve(root, "generated-artifacts/valo-native-browser");
await mkdir(out, { recursive: true });
assert.ok(process.env.REPLIT_DEV_DOMAIN);
const base = new URL("https://" + process.env.REPLIT_DEV_DOMAIN);
const report = {
  source: process.env.VALO_BROWSER_SOURCE ?? null,
  checks: [],
  responses: [],
  authenticatedJourney: "blocked: documented testing agent returned Unknown config kind: testing",
  signInBypassed: false,
  saveHistoryVerified: false,
  apiIdentityTransportControlled: false,
};
let browser, page;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium",
  });
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  page = await context.newPage();
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin === base.origin && (u.pathname.includes("assess") || u.pathname.includes("/checker/")))
      report.responses.push({ method: r.request().method(), path: u.pathname, status: r.status() });
  });
  await page.goto(new URL("/checker", base).href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Clerk?.loaded === true);
  await page.getByTestId("radio-legalForm-unknown").waitFor();
  await page.getByTestId("radio-legalForm-unknown").locator("..").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="radio-legalForm-unknown"]')?.checked,
  );
  assert.ok(await page.getByTestId("radio-legalForm-unknown").isChecked());
  assert.ok(await page.getByTestId("radio-registrationStatus-unanswered").isChecked());
  report.checks.push("Unknown and unanswered remain separate checked answers.");
  assert.equal(await page.locator('[data-testid="rich-section-businessName"]').count(), 0);
  report.checks.push("Private business-name questions absent from public questionnaire.");
  for (let i = 0; i < 5; i++) await page.getByTestId("button-next").click();
  await page.getByTestId("list-review").waitFor();
  await page
    .getByTestId("list-review")
    .getByRole("button", { name: /^Edit / })
    .first()
    .click();
  await page.waitForFunction(() => document.activeElement?.id === "checker-step");
  report.checks.push("Review Edit returns to its question and moves focus.");
  await page.keyboard.press("Tab");
  report.keyboardFocus = await page.evaluate(() => {
    const e = document.activeElement,
      l = e?.closest("label") ?? e,
      s = l ? getComputedStyle(l) : null;
    return { tag: e?.tagName, outlineWidth: s?.outlineWidth, outlineStyle: s?.outlineStyle };
  });
  await page.screenshot({ path: join(out, "keyboard-360.png") });
  for (let i = 0; i < 5; i++) await page.getByTestId("button-next").click();
  // Exact public endpoint from the generated client, not an inferred route name.
  const preview = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).origin === base.origin &&
      new URL(r.url()).pathname.endsWith("/api/checker/preview"),
  );
  await page.getByTestId("button-run").click();
  const response = await preview;
  assert.equal(response.status(), 200);
  await page.getByRole("region", { name: "Results", exact: true }).waitFor();
  assert.ok(
    (await page.getByRole("region", { name: "Results", exact: true }).innerText()).includes(
      "Nothing here has been saved",
    ),
  );
  assert.equal(await page.getByTestId("button-save-assessment").count(), 0);
  report.checks.push("Actual anonymous preview returned 200 and disclosed unsaved result.");
  report.checks.push("No private save control was exposed anonymously.");
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.scroll <= dimensions.viewport, JSON.stringify(dimensions));
    report.checks.push("No page overflow at " + width + "px.");
    await page.screenshot({ path: join(out, "result-" + width + ".png") });
  }
  report.outcome = "public-checks-passed-authenticated-journey-blocked";
} catch (error) {
  report.outcome = "failed";
  report.error = error.message;
  process.exitCode = 1;
  await page?.screenshot({ path: join(out, "failed.png") }).catch(() => {});
} finally {
  await browser?.close();
  await writeFile(join(out, "result.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
}
