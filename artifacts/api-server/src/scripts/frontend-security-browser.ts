/** Exercise the compiled Next application and an enforced production CSP.
 * No provider credentials, database, real identity or external network is used. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
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
  // The web server's own headers and content types (small hardening, part 5): each page, and the
  // files it sends as they are, say what they are, may not be read as anything else, and send no
  // address to another site.
  const said = (response: Response) => ({
    nosniff: response.headers.get("x-content-type-options"),
    referrer: response.headers.get("referrer-policy"),
    type: response.headers.get("content-type") ?? "",
  });
  for (const path of paths) {
    const page = said(await fetch(origin + path));
    assert.equal(page.nosniff, "nosniff", path);
    assert.equal(page.referrer, "same-origin", path);
    assert.match(page.type, /^text\/html; charset=utf-8$/i, path);
  }
  const script = (await (await fetch(origin + "/checker")).text()).match(
    /\/_next\/static\/chunks\/[^"']+\.js/,
  )?.[0];
  assert.ok(script, "the page loads a script of the build's own");
  for (const [path, type] of [
    [script, /^application\/javascript; charset=utf-8$/i],
    ["/favicon.svg", /^image\/svg\+xml$/],
    ["/robots.txt", /^text\/plain; charset=utf-8$/i],
  ] as const) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    const file = said(response);
    assert.equal(file.nosniff, "nosniff", path);
    assert.equal(file.referrer, "same-origin", path);
    assert.match(file.type, type, path);
  }
  checks.push(
    "Each page is HTML in UTF-8, and a script, an image and a text file are sent with their own types; every one carries nosniff and the same-origin referrer policy",
  );
  // The page an unsubscribe link opens has the link's token in its address
  // (docs/architecture/messages.md, part 4). It alone is sent with a policy under which a request says
  // to no one, Valo's own servers included, where it came from. The token here is this check's own.
  const linkToken = "synthetic.unsubscribe.token",
    linkPath = `/unsubscribe?t=${linkToken}`;
  for (const path of [linkPath, "/unsubscribe"]) {
    const answered = said(await fetch(origin + path));
    assert.equal(answered.nosniff, "nosniff", path);
    assert.equal(answered.referrer, "no-referrer", path);
    assert.match(answered.type, /^text\/html; charset=utf-8$/i, path);
  }
  checks.push(
    "The page an unsubscribe link opens is sent with the no-referrer policy, with a token in its address or without",
  );
  // A folder is answered as an address the server does not have, never with a listing: the answer
  // names none of the folder's files, but those the page itself loads.
  for (const folder of ["chunks", "css", "media"]) {
    const files = readdirSync(resolve(front, ".next/static", folder), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    assert.ok(files.length > 0, `the build has files in ${folder}`);
    const response = await fetch(`${origin}/_next/static/${folder}/`);
    assert.ok(
      response.status === 404 || (response.ok && said(response).type.startsWith("text/html")),
      `${folder}: ${response.status}`,
    );
    const rest = (await response.text()).replace(/(?:\/_next\/)?static\/[\w./~%-]+/g, "");
    assert.deepEqual(
      files.filter((name) => rest.includes(name)),
      [],
      `the answer for ${folder} lists its files`,
    );
  }
  checks.push(
    "A folder of the build's files is answered as an address the server does not have, and lists none of its files",
  );
  // TRACE is refused, and repeats nothing the request carried. Next answers it for a file with 405,
  // and for a page with its error page, since the middleware's runtime refuses the method.
  const probe = `synthetic-trace-${randomUUID()}`;
  const trace = (path: string) =>
    new Promise<{ status: number; body: string }>((done, failed) => {
      const sent = httpRequest(
        origin + path,
        { method: "TRACE", headers: { "x-valo-trace-probe": probe } },
        (answer) => {
          let body = "";
          answer.setEncoding("utf8");
          answer.on("data", (chunk: string) => (body += chunk));
          answer.on("end", () => done({ status: answer.statusCode ?? 0, body }));
        },
      );
      sent.on("error", failed);
      sent.end();
    });
  const traced: Record<string, number> = {};
  for (const path of ["/checker", script]) {
    const answer = await trace(path);
    traced[path === script ? "file" : "page"] = answer.status;
    assert.ok(answer.status >= 400, `${path} answers TRACE with ${answer.status}`);
    assert.ok(!answer.body.includes(probe), `${path} repeats what TRACE sent`);
  }
  report.traceStatuses = traced;
  checks.push("TRACE is refused for a page and for a file, and repeats nothing the request carried");
  browser = await chromium.launch({ headless: true, ...chromiumLaunchPath() });
  const context = await browser.newContext(),
    page = await context.newPage();
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  for (const path of paths) {
    const response = await page.goto(origin + path);
    assert.equal(response?.status(), 200, path);
    await expect(page.getByRole("link", { name: "Documents", exact: true }).first()).toBeVisible();
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
  // What a page's own requests say of where they came from, in the browser. A page with the usual
  // policy tells Valo's own server its whole address, which shows that this check would see one. The
  // page an unsubscribe link opens tells no one, and its request to stop the reminders still names the
  // site that sent it, which is what the API checks before it acts (sameOriginMutation).
  const requestsOf = async (path: string, act: (opened: Page) => Promise<void>) => {
    const opened = await context.newPage();
    const made: { url: string; method: string; referer: string | null; origin: string | null }[] = [];
    opened.on("request", (request) => {
      const headers = request.headers();
      made.push({
        url: request.url(),
        method: request.method(),
        referer: headers["referer"] ?? null,
        origin: headers["origin"] ?? null,
      });
    });
    try {
      await opened.goto(origin + path);
      await act(opened);
      return made;
    } finally {
      await opened.close();
    }
  };
  const usual = await requestsOf("/checker?from=synthetic-referrer-probe", async (opened) => {
    await expect(opened.getByRole("link", { name: "Documents", exact: true }).first()).toBeVisible();
  });
  assert.ok(
    usual.some((request) => request.referer === `${origin}/checker?from=synthetic-referrer-probe`),
    "a page with the usual policy tells its own server its address, so this check sees a Referer",
  );
  const sent: unknown[] = [];
  const fromLink = await requestsOf(linkPath, async (opened) => {
    await opened.route(`${origin}/api/public/unsubscribe`, async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ consent: "reminders", state: "off" }),
      });
    });
    await opened.getByTestId("button-unsubscribe").click();
    await expect(opened.getByTestId("unsubscribe-done")).toBeVisible();
  });
  assert.ok(fromLink.length > 1, "the page asks for its scripts and styles");
  // A font is asked for by the stylesheet that names it, so its request names that stylesheet: a file of
  // the build's, whose address holds nothing of the link. No other request names where it came from.
  const stylesheet = /^\/_next\/static\/css\/[\w.-]+\.css$/;
  assert.deepEqual(
    fromLink.filter(
      (request) =>
        request.referer !== null &&
        !(request.referer.startsWith(`${origin}/`) && stylesheet.test(request.referer.slice(origin.length))),
    ),
    [],
    "no request of the unsubscribe page names the page it came from",
  );
  assert.deepEqual(
    fromLink.filter((request) => request.url.includes(linkToken)).map((request) => request.url),
    [origin + linkPath],
    "the token is in the page's own address and in no other request's",
  );
  const stop = fromLink.filter((request) => request.method === "POST");
  assert.deepEqual(
    stop.map((request) => [request.url, request.origin]),
    [[`${origin}/api/public/unsubscribe`, origin]],
    "the one request to stop reminders names the site that sent it",
  );
  assert.deepEqual(sent, [{ token: linkToken }]);
  checks.push(
    "In Chromium, no request the unsubscribe page makes names the page as where it came from or holds the link's token in its address, and its one request to stop reminders carries the page's Origin; a page with the usual policy does send its address to its own server",
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
