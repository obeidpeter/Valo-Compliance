import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, devices, type Route } from "playwright";
import {
  GetBuildStatusResponse,
  GetPublicCoverageResponse,
  GetPublicDiscoveryResponse,
  GetReleasedTemplateResponse,
  ListPublicCatalogueResponse,
  ListReleasedResourcesResponse,
} from "@workspace/api-zod";
import { coveragePlan } from "@workspace/valo-core";
import { startSyntheticApi } from "../test-support/synthetic-api";

/**
 * NFR-002: "Mobile p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 on representative supported
 * devices/connections", accepted with "pre-launch lab checks plus real-user measurements when a
 * sufficient sample exists; disclose sample size".
 *
 * The lab check: the compiled production web app, opened on an emulated mid-range phone (Moto G4
 * screen, four times slower processor) over a slow 4G connection (150 ms round trip, 1.6 Mbit/s
 * down), five fresh loads of each public page. Each load records the largest contentful paint, the
 * layout shift and the slowest response to a tap on the menu button; the p75 of the five is
 * compared with the targets, which LCP, INP and CLS must all meet. Every page measured is rendered
 * by the server (decision 0011). The API is answered with synthetic data the contract's schemas accept:
 * in the page after the slow connection's round trip, and for the web server by a synthetic API on
 * this machine (decision 0011), at once; the API's own time is measured by NFR-003. The identity
 * provider's script cannot load in the lab, so every page is measured as a signed-out visitor sees
 * it. Real-user measurements need a deployed instance, as does a run against one
 * (VALO_PAGE_PERFORMANCE_URL).
 */
const RUNS = 5;
const TARGETS = { lcp: 2500, inp: 200, cls: 0.1 } as const;
const ROUND_TRIP_MS = 150;
const deployed = process.env.VALO_PAGE_PERFORMANCE_URL;
// A deployed instance has its own released templates, so its run leaves the synthetic one out.
const PAGES = deployed
  ? ["/", "/library", "/compliance", "/industries", "/services", "/pricing"]
  : ["/", "/library", "/library/synthetic-template-1", "/compliance", "/industries", "/services", "/pricing"];

/** Nearest-rank percentile. */
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
};

/** Synthetic API answers for the public pages, each checked against the contract's schema. */
function fixtures() {
  const reviewedAt = "2026-11-01T00:00:00.000Z";
  const plan = coveragePlan();
  const industries = plan.industries.map((industry) => ({
    id: industry.id,
    slug: industry.slug,
    title: industry.title,
    deeperPackTarget: industry.deeperPackTarget,
    enhancedEvidenceRequired: industry.enhancedEvidenceRequired,
    coverageState: industry.coverageState,
    evidenceState: industry.evidenceState,
    sourceCheckedAt: industry.sourceCheckedAt,
    publishedItems: industry.publishedItems,
  }));
  const items = Array.from({ length: 40 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    templateId: `TPL-${String(i + 1).padStart(2, "0")}`,
    slug: `synthetic-template-${i + 1}`,
    title: `Synthetic business template ${i + 1}`,
    type: "template",
    industry: industries[i % industries.length]!.slug,
    category: ["Finance and operations", "People", "Sales", "Records"][i % 4]!,
    access: i % 3 ? ("premium" as const) : ("free" as const),
    summary: "Synthetic lab fixture describing what this template records and who it is for.",
    href: `/library/synthetic-template-${i + 1}`,
    reviewedAt,
  }));
  const resources = Array.from({ length: 6 }, (_, i) => ({
    id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`,
    slug: `synthetic-guide-${i + 1}`,
    title: `Synthetic guidance ${i + 1}`,
    kind: "guidance" as const,
    industrySlugs: [industries[i % industries.length]!.slug],
    summary: "Synthetic lab fixture summarising a guidance entry.",
    body: "Synthetic lab fixture body text. ".repeat(40),
    reviewedAt,
    disclosure: "Synthetic lab fixture; not reviewed content.",
    scope: "Synthetic lab fixture scope.",
    limitations: "Synthetic lab fixture limitations.",
    sources: [],
  }));
  return {
    status: GetBuildStatusResponse.parse({
      receivedRequirements: 127,
      expectedRequirements: 127,
      publishedTemplates: items.length,
      p0Passed: false,
      r2Unlocked: false,
      livePaymentsEnabled: false,
      notice: "Synthetic lab fixture.",
    }),
    coverage: GetPublicCoverageResponse.parse({
      industries,
      guidanceTarget: 30,
      publishedGuidance: resources.length,
      guidesTarget: plan.guidesTarget,
      publishedGuides: 0,
      deeperPackTarget: plan.deeperPackTarget,
      publishedDeeperPacks: 0,
      selectableLocations: plan.selectableLocations,
      priorityLocations: plan.priorityLocations,
      checkedLocationPacks: 0,
      notice: "Synthetic lab fixture.",
      ngoNotice: "Synthetic lab fixture.",
    }),
    catalogue: (url: URL) => {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const found = items.filter((item) => !q || item.title.toLowerCase().includes(q));
      return ListPublicCatalogueResponse.parse({
        items: found.slice(0, 12),
        total: found.length,
        page: 1,
        heldTemplates: 0,
      });
    },
    template: (slug: string) => {
      const item = items.find((i) => i.slug === slug) ?? items[0]!;
      return GetReleasedTemplateResponse.parse({
        id: item.id,
        templateId: item.templateId,
        slug: item.slug,
        title: item.title,
        summary: item.summary,
        version: 1,
        reviewedAt,
        reviewBy: "2027-05-01T00:00:00.000Z",
        disclosure: "Synthetic lab fixture; not reviewed content.",
        scope: "Synthetic lab fixture scope.",
        limitations: "Synthetic lab fixture limitations.",
        preview: Array.from({ length: 12 }, (_, n) => `Synthetic preview paragraph ${n + 1}. `.repeat(8)),
        developmentOnly: true,
        commercialLicenceAccepted: false,
        formats: ["docx", "pdf"],
      });
    },
    resources: ListReleasedResourcesResponse.parse(resources),
    discovery: GetPublicDiscoveryResponse.parse({
      items: [
        ...items.map((item) => ({
          path: item.href,
          title: item.title,
          description: item.summary,
          modifiedAt: reviewedAt,
        })),
        ...resources.map((resource) => ({
          path: `/resources/${resource.slug}`,
          title: resource.title,
          description: resource.summary,
          modifiedAt: reviewedAt,
        })),
      ],
    }),
  };
}

/** The synthetic answer for an API address, the same for the browser and the web server. */
function answerFor(data: ReturnType<typeof fixtures>, url: URL): unknown {
  const path = url.pathname.replace(/^\/api/, "");
  return path === "/public/status"
    ? data.status
    : path === "/public/coverage"
      ? data.coverage
      : path === "/public/catalogue"
        ? data.catalogue(url)
        : path === "/public/resources"
          ? data.resources
          : path === "/public/discovery"
            ? data.discovery
            : path.startsWith("/public/templates/")
              ? data.template(decodeURIComponent(path.slice("/public/templates/".length)))
              : undefined;
}

/**
 * Runs in the page before any of its scripts: records the largest contentful paint, layout shifts
 * without recent input, and each interaction's longest event. Kept as page source, since this
 * package is compiled without browser types.
 */
const OBSERVE_VITALS = `(() => {
  const state = { lcp: 0, shifts: [], events: {} };
  window.__vitals = state;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) state.lcp = entry.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (!entry.hadRecentInput) state.shifts.push({ value: entry.value, time: entry.startTime });
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (entry.interactionId)
        state.events[entry.interactionId] = Math.max(state.events[entry.interactionId] || 0, entry.duration);
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
})();`;
const READ_VITALS = `({
  lcp: window.__vitals.lcp,
  shifts: window.__vitals.shifts,
  inp: Math.max(0, ...Object.values(window.__vitals.events)),
})`;
type Vitals = { lcp: number; shifts: { value: number; time: number }[]; inp: number };

/** CLS: the largest sum of shifts in a session window (gaps under 1 s, at most 5 s long). */
function layoutShift(shifts: { value: number; time: number }[]) {
  let worst = 0,
    sum = 0,
    first = 0,
    last = 0;
  for (const shift of shifts) {
    if (sum && (shift.time - last > 1000 || shift.time - first > 5000)) sum = 0;
    if (!sum) first = shift.time;
    sum += shift.value;
    last = shift.time;
    worst = Math.max(worst, sum);
  }
  return worst;
}

type Row = { path: string; lcp: number; inp: number; cls: number };
const rows: Row[] = [];
const unknown = new Set<string>();
/** API paths the web server asked the synthetic API for and found no answer. */
let serverUnknown = new Set<string>();

// One measurement for both tests below: five fresh loads of each page.
before(
  async () => {
    const root = resolve(import.meta.dirname, "../../../..");
    const front = resolve(root, "artifacts/valo");
    let origin = deployed ? new URL(deployed).origin : "";
    let server: ReturnType<typeof spawn> | undefined;
    const data = fixtures();
    // The web server's own reads, answered at once: it and the API sit side by side.
    const api = deployed
      ? undefined
      : await startSyntheticApi((_method, url) => {
          const body = answerFor(data, url);
          return body === undefined ? undefined : { status: 200, body };
        });
    if (api) serverUnknown = api.unknown;
    if (!deployed) {
      // Pass only OS essentials; never inherit provider or database credentials.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => /^(PATH|HOME|LANG|LC_ALL|TMPDIR)$/i.test(key)),
      );
      const reservation = createServer().listen(0, "127.0.0.1");
      await once(reservation, "listening");
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((r) => reservation.close(() => r()));
      origin = `http://127.0.0.1:${port}`;
      const next = createRequire(resolve(front, "package.json")).resolve("next/dist/bin/next");
      server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: front,
        env: {
          ...env,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          VALO_API_INTERNAL_ORIGIN: api!.origin,
        },
        stdio: "ignore",
      });
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt++) {
        assert.equal(server.exitCode, null, "the compiled web app started");
        ready = await fetch(origin + "/library").then(
          (r) => r.ok,
          () => false,
        );
        if (!ready) await delay(250);
      }
      assert.ok(ready, "the compiled web app answers");
    }
    const answer = async (route: Route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, "");
      const body = answerFor(data, url);
      await delay(ROUND_TRIP_MS);
      if (body === undefined) {
        unknown.add(path);
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: '{"error":"Sign-in required"}',
        });
      } else
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    };

    const browser = await chromium.launch({
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
      args: ["--no-sandbox"],
    });
    try {
      for (const path of PAGES) {
        const runs: { lcp: number; inp: number; cls: number }[] = [];
        for (let run = 0; run < RUNS; run++) {
          const context = await browser.newContext({ ...devices["Moto G4"] });
          try {
            const page = await context.newPage();
            if (!deployed) {
              await page.route(`${origin}/api/**`, answer);
              // Any other host (the identity provider's script) is unreachable in the lab.
              await page.route(
                (url) => url.origin !== origin,
                (route) => route.abort(),
              );
            }
            const cdp = await context.newCDPSession(page);
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
            await cdp.send("Network.enable");
            await cdp.send("Network.emulateNetworkConditions", {
              offline: false,
              latency: ROUND_TRIP_MS,
              downloadThroughput: (1.6 * 1024 * 1024) / 8,
              uploadThroughput: (750 * 1024) / 8,
            });
            await page.addInitScript(OBSERVE_VITALS);
            const response = await page.goto(origin + path, { waitUntil: "load", timeout: 60_000 });
            assert.equal(response?.status(), 200, `${path} loads`);
            await page
              .getByRole("button", { name: "Open menu" })
              .waitFor({ state: "visible", timeout: 60_000 });
            await delay(3000); // Let late content settle before the first input ends LCP.
            await page.getByRole("button", { name: "Open menu" }).tap();
            await page.getByRole("button", { name: "Close menu" }).waitFor({ state: "visible" });
            await delay(500);
            const vitals = (await page.evaluate(READ_VITALS)) as Vitals;
            assert.ok(vitals.lcp > 0, `${path} recorded a largest contentful paint`);
            runs.push({ lcp: vitals.lcp, inp: vitals.inp, cls: layoutShift(vitals.shifts) });
          } finally {
            await context.close();
          }
        }
        rows.push({
          path,
          lcp: percentile(
            runs.map((r) => r.lcp),
            75,
          ),
          inp: percentile(
            runs.map((r) => r.inp),
            75,
          ),
          cls: percentile(
            runs.map((r) => r.cls),
            75,
          ),
        });
      }
    } finally {
      await browser.close();
      server?.kill("SIGTERM");
      await api?.close();
    }
    const summary = [
      `### NFR-002 lab check: p75 of ${RUNS} fresh loads per page, emulated Moto G4, 4x slower CPU, slow 4G`,
      "",
      "| Page | LCP ms | INP ms | CLS |",
      "| --- | ---: | ---: | ---: |",
      ...rows.map((r) => `| ${r.path} | ${r.lcp.toFixed(0)} | ${r.inp.toFixed(0)} | ${r.cls.toFixed(3)} |`),
      "",
      `Targets: LCP ${TARGETS.lcp} ms, INP ${TARGETS.inp} ms, CLS ${TARGETS.cls}. ${deployed ? "Measured against a deployed instance." : "API answered with synthetic data, in the page and for the web server; the identity provider's script does not load."} No real-user measurement exists before launch.`,
      "",
    ].join("\n");
    process.stdout.write(summary + "\n");
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  },
  { timeout: 900_000 },
);

test("public pages answer a tap within NFR-002's INP target and keep CLS within 0.1 on an emulated mid-range phone", () => {
  assert.deepEqual([...unknown].sort(), [], "every API call a public page makes has a lab answer");
  assert.deepEqual([...serverUnknown].sort(), [], "every API call the web server makes has a lab answer");
  assert.deepEqual(
    rows.map((row) => row.path),
    PAGES,
    "every page was measured",
  );
  for (const row of rows) {
    assert.ok(
      row.inp <= TARGETS.inp,
      `${row.path} p75 INP ${row.inp.toFixed(0)} ms exceeds ${TARGETS.inp} ms`,
    );
    assert.ok(row.cls <= TARGETS.cls, `${row.path} p75 CLS ${row.cls.toFixed(3)} exceeds ${TARGETS.cls}`);
  }
});

test("public pages reach NFR-002's LCP target on an emulated mid-range phone", () => {
  assert.equal(rows.length, PAGES.length, "every page was measured");
  for (const row of rows)
    assert.ok(
      row.lcp <= TARGETS.lcp,
      `${row.path} p75 LCP ${row.lcp.toFixed(0)} ms exceeds ${TARGETS.lcp} ms`,
    );
});
