/** Exercise the compiled Next application and an enforced production CSP.
 * No provider credentials, database, real identity or external network is used. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { chromiumLaunchPath } from "../platform/chromium";

const root = resolve(import.meta.dirname, "../../../.."),
  front = resolve(root, "artifacts/valo");
const require = createRequire(resolve(front, "package.json"));
// The pages the web app server-renders, from its source; loaded at run time, since this package's
// build cannot import another package's source.
const { SERVER_PAGES } = (await import(pathToFileURL(resolve(front, "src/lib/server-pages.ts")).href)) as {
  SERVER_PAGES: readonly string[];
};
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const origin = `http://127.0.0.1:${port}`,
  checks: string[] = [];
// Pass only OS essentials; never inherit provider or database credentials.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|LANG|LC_ALL)$/i.test(key),
  ),
);
const server = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: front,
    env: { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let serverLog = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    serverLog = (serverLog + String(chunk)).slice(-4000);
  });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const report: Record<string, unknown> = {
  checks,
  compiledNextApplication: true,
  controlledIdentity: false,
  realIdentity: false,
  productionCsp: true,
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw Error("NEXT_START_FAILED: " + serverLog);
    try {
      const response = await fetch(origin);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Expected while the server is still starting; keep polling.
    }
    await delay(250);
  }
  assert.ok(ready, "compiled Next server starts");
  // A page the browser app renders, and each page the server renders itself (decision 0011).
  const paths = ["/checker", ...SERVER_PAGES];
  for (const path of paths) {
    const first = await fetch(origin + path, {
      headers: {
        "x-valo-nonce": "attacker-chosen-nonce",
        "content-security-policy": "script-src * 'unsafe-inline'",
      },
    });
    const policy = first.headers.get("content-security-policy") ?? "",
      nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce, path);
    assert.notEqual(nonce, "attacker-chosen-nonce", path);
    assert.ok(!(await first.text()).includes("attacker-chosen-nonce"), `${path} never uses a supplied nonce`);
    assert.match(policy, /script-src [^;]*'strict-dynamic'/);
    assert.doesNotMatch(policy, /script-src[^;]*'unsafe-(?:inline|eval)'/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(first.headers.get("cache-control") ?? "", /no-store/);
    const second = await fetch(origin + path);
    assert.notEqual(
      second.headers.get("content-security-policy")?.match(/'nonce-([^']+)'/)?.[1],
      nonce,
      path,
    );
  }
  checks.push(
    "Actual Next responses enforce unique server-generated nonces, reject supplied policy/nonce, disallow framing and prevent HTML caching, on the browser app's page and every server-rendered page",
  );
  browser = await chromium.launch({ headless: true, ...chromiumLaunchPath() });
  const context = await browser.newContext(),
    page = await context.newPage();
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  for (const path of paths) {
    const response = await page.goto(origin + path);
    assert.equal(response?.status(), 200, path);
    await expect(page.getByRole("link", { name: "Library", exact: true }).first()).toBeVisible();
    await expect(page.getByText("Loading Valo", { exact: true })).toHaveCount(0);
    const liveNonce = response!.headers()["content-security-policy"]!.match(/'nonce-([^']+)'/)![1];
    // Webpack loads a lazy chunk, such as an island's, with a script element it marks data-webpack
    // and removes once the chunk has run. The policy's 'strict-dynamic' trusts it because a nonced
    // script created it. Every other script must carry the response nonce.
    const scripts = await page
      .locator("script:not([data-webpack])")
      .evaluateAll((elements) =>
        elements
          .filter((e) => !e.getAttribute("type") || e.getAttribute("type") === "text/javascript")
          .map((e) => (e as unknown as { nonce: string }).nonce),
      );
    assert.ok(scripts.length > 0, path);
    assert.ok(
      scripts.every((n) => n === liveNonce),
      `${path}: Next bootstrap and inline flight scripts carry the response nonce`,
    );
  }
  checks.push(
    "Compiled application hydrates under production CSP with all Next executable script elements nonced, on the browser app's page and every server-rendered page",
  );
  // Inject at the HTML/parser boundary. DevTools evaluation is privileged and
  // does not model an attacker inserting untrusted HTML into a response.
  for (const path of paths) {
    await page.route(origin + path + "?csp-canary=1", async (route) => {
      const upstream = await route.fetch(),
        nonce = upstream.headers()["content-security-policy"]!.match(/'nonce-([^']+)'/)![1];
      const canaries =
        '<script>document.documentElement.setAttribute("data-csp-denied","ran")</script>' +
        `<script nonce="${nonce}">document.documentElement.setAttribute("data-csp-allowed","ran")</script>`;
      await route.fulfill({
        response: upstream,
        body: (await upstream.text()).replace("<head>", "<head>" + canaries),
      });
    });
    await page.goto(origin + path + "?csp-canary=1");
    const result = await page.evaluate(() => ({
      denied: (globalThis as any).document.documentElement.getAttribute("data-csp-denied") === null,
      allowed: (globalThis as any).document.documentElement.getAttribute("data-csp-allowed") === "ran",
    }));
    assert.deepEqual(result, { denied: true, allowed: true }, path);
  }
  checks.push(
    "Chromium actually blocks injected non-nonced JavaScript while allowing a script bearing the server nonce, on the browser app's page and every server-rendered page",
  );
  report.status = "passed_compiled_frontend_security_not_real_mfa";
} catch (error) {
  report.status = "failed";
  report.failure = error instanceof Error ? error.message.slice(0, 1500) : "FRONTEND_SECURITY_FAILED";
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await Promise.race([once(server, "exit"), delay(5000)]);
  const output = resolve(root, "generated-artifacts/valo-completion");
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "frontend-security-browser.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
