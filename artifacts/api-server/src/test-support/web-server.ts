import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, devices, type BrowserContextOptions } from "playwright";
import { startSyntheticApi, type SyntheticAnswer } from "./synthetic-api";

const front = resolve(import.meta.dirname, "../../../valo");

/** Answers an API request from the web server or from the browser, as `from` says. */
type Answer = (
  method: string,
  url: URL,
  from: "server" | "browser",
) => SyntheticAnswer | undefined | Promise<SyntheticAnswer | undefined>;

/**
 * The compiled web app (`next start`, production mode) pointed at a synthetic API on this machine
 * with VALO_API_INTERNAL_ORIGIN, for the checks of server-rendered public pages (decision 0011). The
 * browser's own API calls are answered in the page from the same answers. The web server gets only
 * the operating system's essentials, never provider or database credentials. Build the web app
 * first: pnpm --filter @workspace/valo run build.
 */
export async function startWebServer(answer: Answer) {
  const api = await startSyntheticApi((method, url) => answer(method, url, "server"));
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => /^(PATH|HOME|LANG|LC_ALL|TMPDIR)$/i.test(key)),
  );
  const next = createRequire(resolve(front, "package.json")).resolve("next/dist/bin/next");
  const server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: front,
    env: {
      ...env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      VALO_API_INTERNAL_ORIGIN: api.origin,
    },
    stdio: "ignore",
  });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    assert.equal(server.exitCode, null, "the compiled web app started");
    ready = await fetch(origin + "/terms").then(
      (response) => response.ok,
      () => false,
    );
    if (!ready) await delay(250);
  }
  assert.ok(ready, "the compiled web app answers; build it first: pnpm --filter @workspace/valo run build");
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"],
  });

  /** A page in a browser context of its own; its API calls get the same answers, and any other host
   * is unreachable. */
  async function open(path: string, options: BrowserContextOptions) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const unknown: string[] = [],
      errors: string[] = [],
      messages: string[] = [];
    page.on("pageerror", (error) => {
      // The build's identity key names a reserved, unreachable host (RFC 2606), so the identity
      // provider's script never loads here; that one failure is expected, every other is not.
      if (!IDENTITY_UNREACHABLE.test(error.message)) errors.push(error.message);
    });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) messages.push(message.text());
    });
    await page.route(`${origin}/api/**`, async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const found = await answer(request.method(), url, "browser");
      if (!found) unknown.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({
        status: found?.status ?? 404,
        contentType: "application/json",
        body: JSON.stringify(found?.body ?? { error: "No test answer" }),
      });
    });
    await page.route(
      (url) => url.origin !== origin,
      (route) => route.abort(),
    );
    await page.goto(origin + path, { waitUntil: "load" });
    return { page, unknown, errors, messages, close: () => context.close() };
  }

  return {
    origin,
    api,
    /** A page on the screen `options` describes, such as a phone or a desktop that is recorded. */
    open,
    /** A phone-sized page (Moto G4). */
    phone: (path: string) => open(path, { ...devices["Moto G4"] }),
    /** A page as wide as a desktop screen, where the site lays itself out in full. */
    desktop: (path: string) => open(path, { viewport: { width: 1440, height: 900 } }),
    async close() {
      await browser.close();
      server.kill("SIGTERM");
      await api.close();
    },
  };
}

/** The identity provider's own report that its script could not load. */
const IDENTITY_UNREACHABLE = /failed_to_load_clerk_js/;

/** A console message or page error that reports a hydration mismatch, in React's development or
 * production wording. */
export const HYDRATION = /hydrat|react\.dev\/errors\/(418|423|425)\b|Minified React error #(418|423|425)\b/i;
