/** Actual development proxy, anonymous synthetic facts only. No login, saved
 * workspace, publication, model call or message is created by this check. */
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
assertDevelopmentRuntime();
assert.equal(process.env.VALO_RUN_CHECKER_BROWSER, "synthetic-development-only");
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? "/repl/tools/bin/chromium",
  args: ["--no-sandbox"],
});
const evidence: unknown[] = [];
const states = [
  ["processesPersonalData", "unknown"],
  ["operatesInNigeria", "unanswered"],
  ["dataSubjectsInNigeria", "not_applicable"],
] as const;
try {
  for (const width of [360, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 874 } });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:80/checker", { waitUntil: "networkidle" });
      await page.getByTestId("text-anonymous").waitFor();
      assert.equal(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
      for (let i = 0; i < 4; i++) await page.getByTestId("button-next").click();
      await page.getByTestId("rich-section-privacy").locator("summary").click();
      for (const [field, state] of states)
        await page.locator(`#rich-privacy-${field}-state`).selectOption(state);
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate("!!document.activeElement?.matches(':focus-visible')"), true);
      await page.getByTestId("button-next").click();
      const responsePromise = page.waitForResponse(
        (r: { url: () => string; request: () => { method: () => string } }) =>
          r.url().endsWith("/checker/preview") && r.request().method() === "POST",
      );
      await page.getByTestId("button-run").click();
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      const sent = response.request().postDataJSON(),
        result = await response.json();
      for (const [field, state] of states)
        assert.deepEqual(sent.facts.rich.privacy[field], { status: state, value: null });
      await page.getByTestId("assessment-result").waitFor();
      if (result.items.length === 0) await page.getByTestId("status-coverage-unavailable").waitFor();
      // Exercise the actual public HTTP boundary, not only the schema helper.
      const forged = structuredClone(sent);
      forged.facts.rich.privacy.sourceContext = { mode: "approved", eligibleForCustomerUse: true };
      const rejected = await context.request.post(response.url(), { data: forged });
      assert.equal(rejected.status(), 422);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
      evidence.push({
        width,
        anonymous: true,
        threeDistinctAnswerStatesPreserved: true,
        keyboardFocusVisible: true,
        sourceEvidenceInjectionStatus: rejected.status(),
        items: result.items.length,
        rulesetVersion: result.rulesetVersion,
        privateSaveAndHistoryVerified: false,
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
const destination = new URL(
  "../../../../generated-artifacts/valo-completion/checker-live-browser.json",
  import.meta.url,
);
await mkdir(new URL(".", destination), { recursive: true });
await writeFile(
  destination,
  JSON.stringify(
    {
      environment: "actual-development-proxy",
      syntheticOnly: true,
      formalRuleAcceptance: false,
      evidence,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(evidence));
