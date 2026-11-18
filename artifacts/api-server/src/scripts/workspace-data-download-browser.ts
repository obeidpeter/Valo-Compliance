/** Real React/account-boundary/native-download journey with controlled HTTP
 * jobs and synthetic cookies. No real identity, database, worker or provider. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { developmentPublicationOnly, publicationWorkspaceRoot } from "../editorial/operational-policy";
import type { WorkspaceExportJob as WorkspaceExportModel } from "@workspace/api-zod";
// JSON transport dates are ISO strings; the generated server model uses Date.
type WorkspaceDataExportJob = Omit<WorkspaceExportModel, "createdAt" | "expiresAt"> & {
  createdAt: string;
  expiresAt: string;
};

developmentPublicationOnly();
if (process.env.VALO_RUN_WORKSPACE_DOWNLOAD_BROWSER !== "synthetic-development-only")
  throw Error("EXPLICIT_SYNTHETIC_BROWSER_FLAG_REQUIRED");
const root = publicationWorkspaceRoot(),
  front = resolve(root, "artifacts/valo");
const out = resolve(root, "generated-artifacts/valo-completion");
await mkdir(out, { recursive: true });
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
  import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';
  import {AccountStateBoundary} from './src/components/account-state-boundary';
  import {WorkspaceExportJobs} from './src/components/workspace-export-jobs';
  window.actor=sessionStorage.getItem('fixtureActor')||'A';
  document.cookie='fixture_actor='+window.actor+'; Path=/; SameSite=Lax';
  const app=createRoot(document.getElementById('root'));
  const render=()=>app.render(<AccountStateBoundary identityKey={window.actor}><main><h1>Controlled workspace exports</h1><WorkspaceExportJobs pollMs={100}/></main></AccountStateBoundary>);
  window.switchActor=actor=>{if(!['A','B'].includes(actor))throw Error('INVALID_FIXTURE_ACTOR');
    sessionStorage.setItem('fixtureActor',actor);document.cookie='fixture_actor='+actor+'; Path=/; SameSite=Lax';window.actor=actor;flushSync(render)};render();`,
    loader: "tsx",
    resolveDir: front,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  alias: { "@": resolve(front, "src") },
  define: { "process.env": "{}" },
});

type FixtureJob = WorkspaceDataExportJob & { owner: string; key: string };
const jobs = new Map<string, FixtureJob>();
const pendingDetails = new Map<string, ServerResponse>();
let sequence = 0,
  loseFirstCreate = true,
  conflictNextCancel = false,
  holdDetail: string | null = null,
  denyFile: string | null = null;
let lostCreateResponse: ServerResponse | null = null;
const metrics = {
  createCalls: 0,
  created: 0,
  createKeys: [] as string[],
  cancelled: 0,
  retried: 0,
  conflicts: 0,
  detailReads: 0,
  abortedDetails: 0,
  fileOwners: [] as string[],
};
const publicJob = ({ owner, key, ...job }: FixtureJob): WorkspaceDataExportJob => job;
function change(job: FixtureJob, status: WorkspaceDataExportJob["status"], expiresInMs = 86_400_000) {
  job.status = status;
  job.version++;
  job.retryAvailable = status === "interrupted";
  job.errorCode = status === "interrupted" ? "PREPARATION_FAILED" : null;
  job.expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  if (status === "preparing" || status === "ready") {
    job.progress.rows = status === "ready" ? 6001 : 5000;
    job.progress.bytes = status === "ready" ? 9_500_000 : 8_000_000;
  }
}
const handle = async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://fixture");
  res.setHeader("Cache-Control", "private, no-store");
  const json = (value: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  };
  if (url.pathname === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0]!.text);
    return;
  }
  if (url.pathname === "/__fixture/status") {
    json({ ...metrics, pendingDetails: pendingDetails.size });
    return;
  }
  if (url.pathname === "/__fixture/control") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const command = JSON.parse(body) as {
      id?: string;
      status?: WorkspaceDataExportJob["status"];
      expiresInMs?: number;
      conflictNextCancel?: boolean;
      holdDetail?: string;
      denyFile?: string | null;
      releaseLostCreate?: boolean;
    };
    if (command.releaseLostCreate) {
      if (lostCreateResponse) {
        lostCreateResponse.writeHead(503, { "Content-Type": "application/json" });
        lostCreateResponse.end(JSON.stringify({ error: "Saved request; controlled response unavailable." }));
      }
      lostCreateResponse = null;
    }
    if (command.id && command.status) change(jobs.get(command.id)!, command.status, command.expiresInMs);
    if (command.conflictNextCancel !== undefined) conflictNextCancel = command.conflictNextCancel;
    if (command.holdDetail !== undefined) holdDetail = command.holdDetail;
    if ("denyFile" in command) denyFile = command.denyFile ?? null;
    json({ changed: true });
    return;
  }
  if (!url.pathname.startsWith("/api/workspace/data-exports")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Controlled export jobs</title><style>body{font:16px system-ui;margin:16px;overflow-wrap:anywhere}main{max-width:700px}button{min-height:44px;margin:4px;padding:8px}li{list-style:none;border:1px solid #ddd;padding:12px;margin:12px 0}ul{padding:0}p{line-height:1.5}button:focus-visible{outline:3px solid #18583d}</style><div id="root"></div><script src="/fixture.js"></script></html>',
    );
    return;
  }
  const owner = /(?:^|;\s*)fixture_actor=([AB])(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
  if (!owner) {
    json({ error: "Sign in to view exports." }, 401);
    return;
  }
  const match = /^\/api\/workspace\/data-exports(?:\/([^/]+)(?:\/(download|cancel|retry))?)?$/.exec(
    url.pathname,
  );
  if (!match) {
    json({ error: "Not found." }, 404);
    return;
  }
  const [, id, action] = match;
  if (!id && req.method === "GET") {
    const rows = [...jobs.values()].filter((job) => job.owner === owner).reverse();
    const cursor = url.searchParams.get("cursor");
    const offset = cursor ? rows.findIndex((job) => job.id === cursor) + 1 : 0;
    const page = rows.slice(offset, offset + 2);
    json({
      items: page.map(publicJob),
      nextCursor: offset + page.length < rows.length ? page.at(-1)!.id : null,
    });
    return;
  }
  if (!id && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    metrics.createCalls++;
    metrics.createKeys.push(input.requestKey);
    let job = [...jobs.values()].find((row) => row.owner === owner && row.key === input.requestKey);
    if (!job) {
      sequence++;
      const jobId = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      job = {
        id: jobId,
        owner,
        key: input.requestKey,
        status: "queued",
        version: 1,
        attempts: 0,
        progress: { section: null, rows: 0, bytes: 0 },
        createdAt: new Date(Date.now() + sequence).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        snapshotAt: null,
        size: null,
        counts: null,
        errorCode: null,
        notice: "Synthetic application sections only; not complete privacy fulfilment.",
        retryAvailable: false,
      };
      jobs.set(jobId, job);
      metrics.created++;
    }
    if (loseFirstCreate) {
      loseFirstCreate = false;
      lostCreateResponse = res;
      return;
    }
    json(publicJob(job));
    return;
  }
  const job = jobs.get(id!);
  if (!job || job.owner !== owner) {
    json({ error: "Export not found." }, 404);
    return;
  }
  if (action === "download") {
    if (denyFile === id) {
      json({ error: "Your access to this prepared file is no longer available." }, 403);
      return;
    }
    if (job.status !== "ready" || !job.expiresAt || Date.parse(job.expiresAt) <= Date.now()) {
      json({ error: "This file has expired." }, 409);
      return;
    }
    metrics.fileOwners.push(owner);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="valo-workspace-data.json"');
    res.end(
      JSON.stringify({
        schemaVersion: 2,
        workspaceId: owner,
        data: {
          records: Array.from({ length: 6001 }, (_, index) => ({
            id: index,
            workspaceId: owner,
            text: "x".repeat(1536),
          })),
        },
      }),
    );
    return;
  }
  if (action === "cancel" || action === "retry") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (action === "cancel" && conflictNextCancel) {
      conflictNextCancel = false;
      change(job, "cancelled");
      metrics.conflicts++;
      json({ error: "The export changed." }, 409);
      return;
    }
    if (input.expectedVersion !== job.version) {
      json({ error: "The export changed." }, 409);
      return;
    }
    if (
      (action === "cancel" && ["cancelled", "expired"].includes(job.status)) ||
      (action === "retry" && !job.retryAvailable)
    ) {
      json({ error: "This action is no longer available." }, 409);
      return;
    }
    if (action === "cancel") {
      change(job, "cancelled");
      metrics.cancelled++;
    } else {
      change(job, "queued");
      metrics.retried++;
    }
    json(publicJob(job));
    return;
  }
  metrics.detailReads++;
  if (holdDetail === id) {
    pendingDetails.set(id, res);
    res.once("close", () => {
      if (pendingDetails.delete(id)) metrics.abortedDetails++;
    });
    return;
  }
  json(publicJob(job));
};
// A failure ends this harness with an unhandled rejection, as it did when createServer called
// the async handler directly.
const server = createServer((req, res) => void handle(req, res));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw Error("NO_FIXTURE_PORT");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
});
const context = await browser.newContext({ viewport: { width: 360, height: 800 }, acceptDownloads: true });
await context.addInitScript(() => {
  const fetch = globalThis.fetch;
  globalThis.fetch = (...args: Parameters<typeof globalThis.fetch>) => {
    if (/\/data-exports\/[^/]+\/download/.test(String(args[0])))
      throw Error("FILE_MUST_USE_NATIVE_ATTACHMENT");
    return fetch(...args);
  };
  globalThis.Blob = new Proxy(globalThis.Blob, {
    construct() {
      throw Error("NO_EXPORT_BLOB");
    },
  });
  URL.createObjectURL = () => {
    throw Error("NO_EXPORT_OBJECT_URL");
  };
  const parse = JSON.parse;
  JSON.parse = (text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
    if (text.includes('"schemaVersion":2') && text.includes('"data":')) throw Error("NO_EXPORT_BODY_PARSE");
    return parse(text, reviver);
  };
});
const page = await context.newPage(),
  checks: string[] = [],
  runtimeErrors: string[] = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
const control = async (data: Record<string, unknown>) => {
  expect((await page.request.post(origin + "/__fixture/control", { data })).ok()).toBe(true);
};
const fixtureStatus = async () => (await page.request.get(origin + "/__fixture/status")).json();
const row = (id: string) => page.getByTestId(`workspace-export-${id}`);
const status = (id: string) => page.getByTestId(`export-status-${id}`);
const latestId = () => [...jobs.keys()].at(-1)!;
async function create() {
  const before = metrics.created;
  await page.getByTestId("button-request-workspace-export").click();
  await expect.poll(() => metrics.created).toBe(before + 1);
  const id = latestId();
  await expect(row(id)).toBeVisible();
  return id;
}
let passed = false;
let heapEvidence: { baseline: number; peak: number; increase: number; bound: number } | undefined;
let heapSampler: ReturnType<typeof setInterval> | undefined;
try {
  await page.goto(origin);
  const request = page.getByTestId("button-request-workspace-export");
  await expect(request).toBeEnabled();
  await request.focus();
  await page.keyboard.press("Enter");
  await expect(request).toBeDisabled();
  await expect.poll(() => metrics.createCalls).toBe(1);
  await control({ releaseLostCreate: true });
  await expect(page.getByRole("button", { name: "Retry export request" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry export request" }).click();
  const first = latestId();
  await expect(status(first)).toHaveText("Queued");
  expect(metrics.created).toBe(1);
  expect(metrics.createCalls).toBe(2);
  expect(metrics.createKeys[0]).toBe(metrics.createKeys[1]);
  await page.reload();
  await expect(status(first)).toHaveText("Queued");
  expect(metrics.created).toBe(1);
  await control({ id: first, status: "preparing" });
  await expect(status(first)).toHaveText("Preparing");
  await expect(row(first)).toContainText("5,000 rows read");
  await control({ id: first, status: "ready" });
  await expect(status(first)).toHaveText("Ready to download");
  const metricsSession = await context.newCDPSession(page);
  await metricsSession.send("Performance.enable");
  await metricsSession.send("HeapProfiler.collectGarbage");
  const heap = async () =>
    (await metricsSession.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize")
      ?.value ?? NaN;
  const baseline = await heap();
  let peak = baseline;
  heapSampler = setInterval(() => {
    void heap()
      .then((value) => {
        peak = Math.max(peak, value);
      })
      // Sampling is best-effort; the page may be closing.
      .catch(() => {});
  }, 10);
  const event = page.waitForEvent("download");
  await page.getByTestId(`export-${first}-file`).focus();
  await page.keyboard.press("Enter");
  const path = await (await event).path();
  if (!path) throw Error("DOWNLOAD_MISSING");
  const bytes = await readFile(path, "utf8");
  peak = Math.max(peak, await heap());
  clearInterval(heapSampler);
  heapSampler = undefined;
  heapEvidence = { baseline, peak, increase: peak - baseline, bound: 8 * 1024 * 1024 };
  expect(Number.isFinite(peak) && peak - baseline < heapEvidence.bound).toBe(true);
  const file = JSON.parse(bytes);
  expect(file.workspaceId).toBe("A");
  expect(file.data.records).toHaveLength(6001);
  expect(file.data.records.map((r: { id: number }) => r.id).sort((a: number, b: number) => a - b)).toEqual(
    Array.from({ length: 6001 }, (_, i) => i),
  );
  expect(Buffer.byteLength(bytes)).toBeGreaterThan(8_000_000);
  await expect(row(first)).toContainText("Download requested; check browser downloads.");
  await expect(row(first)).not.toContainText("Downloaded.");
  checks.push(
    "Ambiguous create reused one idempotency key; actual reload recovered the queued job; polling reached ready and keyboard downloaded >8MB/6001 rows natively.",
  );

  const cancelled = await create();
  await page.getByTestId(`cancel-export-${cancelled}`).click();
  await expect(status(cancelled)).toHaveText("Cancelled");
  expect(metrics.cancelled).toBe(1);
  const retried = await create();
  await control({ id: retried, status: "interrupted" });
  await expect(status(retried)).toHaveText("Preparation interrupted");
  await page.getByTestId(`retry-export-${retried}`).click();
  await expect(status(retried)).toHaveText("Queued");
  expect(metrics.retried).toBe(1);
  await control({ id: retried, status: "ready", expiresInMs: 2500 });
  await expect(page.getByTestId(`export-${retried}-file`)).toBeVisible();
  await expect(status(retried)).toHaveText("Expired", { timeout: 6000 });
  await expect(page.getByTestId(`export-${retried}-file`)).toHaveCount(0);
  const conflicted = await create();
  await control({ conflictNextCancel: true });
  await page.getByTestId(`cancel-export-${conflicted}`).click();
  await expect(status(conflicted)).toHaveText("Cancelled");
  await expect(page.getByRole("alert")).toContainText("current status has been refreshed");
  expect(metrics.cancelled).toBe(1);
  expect(metrics.conflicts).toBe(1);
  checks.push(
    "Explicit cancellation and manual retry used versions; ready expiry removed download;409 refreshed current status without replaying the mutation.",
  );

  await page.reload();
  await expect(page.getByTestId("button-older-workspace-exports")).toBeVisible();
  await page.getByTestId("button-older-workspace-exports").click();
  await expect(page.locator('li[data-testid^="workspace-export-"]')).toHaveCount(4);
  await control({ denyFile: first });
  await page.getByTestId(`export-${first}-file`).click();
  await expect(page.getByTestId(`export-${first}-download-error`)).toContainText(
    "access to this prepared file is no longer available",
  );
  await control({ denyFile: null });
  checks.push(
    "Paged history recovered older jobs; native file authorization denial appeared as a bounded readable error, not download success.",
  );

  await expect(status(first)).toHaveText("Ready to download");
  await expect(row(first)).toContainText(
    "Cleanup follows recorded holds; downloaded copies are not removed.",
  );
  const removePrepared = row(first).getByRole("button", { name: "Remove prepared export", exact: true });
  await removePrepared.focus();
  await page.keyboard.press("Enter");
  await expect(status(first)).toHaveText("Cancelled");
  await expect(page.getByTestId(`export-${first}-file`)).toHaveCount(0);
  await expect(removePrepared).toHaveCount(0);
  expect(metrics.cancelled).toBe(2);
  await expect(page.getByRole("status")).toContainText("Prepared export availability withdrawn.");
  const withdrawn = await page.request.get(origin + `/api/workspace/data-exports/${first}/download`);
  expect(withdrawn.status()).toBe(409);
  expect(withdrawn.headers()["content-disposition"]).toBeUndefined();
  checks.push(
    "Keyboard removal changed an actual ready job to cancelled, removed its file control and denied the copied file URL; copy explains recorded cleanup holds and retained downloaded copies.",
  );

  const held = await create();
  await control({ holdDetail: held });
  await expect.poll(async () => (await fixtureStatus()).pendingDetails).toBe(1);
  await page.evaluate("window.switchActor('B')");
  await expect.poll(async () => (await fixtureStatus()).abortedDetails).toBe(1);
  await expect(page.locator('li[data-testid^="workspace-export-"]')).toHaveCount(0);
  await expect(page.getByText("No export requests yet.")).toBeVisible();
  expect((await page.request.get(origin + `/api/workspace/data-exports/${first}/download`)).status()).toBe(
    404,
  );
  const next = await create();
  await control({ id: next, status: "ready" });
  await expect(status(next)).toHaveText("Ready to download");
  const bEvent = page.waitForEvent("download");
  await page.getByTestId(`export-${next}-file`).click();
  const bPath = await (await bEvent).path();
  if (!bPath) throw Error("DOWNLOAD_MISSING");
  const b = JSON.parse(await readFile(bPath, "utf8"));
  expect(b.workspaceId).toBe("B");
  expect(b.data.records.every((record: { workspaceId: string }) => record.workspaceId === "B")).toBe(true);
  expect(metrics.fileOwners).toEqual(["A", "B"]);
  expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
  expect(runtimeErrors).toEqual([]);
  checks.push(
    "Real account boundary aborted the old metadata request and cleared A jobs; B could not retrieve A file and downloaded only B rows.360px keyboard/native transport checks passed.",
  );
  passed = true;
} finally {
  clearInterval(heapSampler);
  const sourceHashes = await Promise.all(
    [
      "src/components/workspace-export-jobs.tsx",
      "src/lib/workspace-export-jobs.ts",
      "src/components/workspace-data-download.tsx",
      "src/components/prepared-workspace-download.tsx",
      "src/components/account-state-boundary.tsx",
    ].map(async (path) => ({
      path: `artifacts/valo/${path}`,
      sha256: createHash("sha256")
        .update(await readFile(resolve(front, path)))
        .digest("hex"),
    })),
  );
  await writeFile(
    resolve(out, "workspace-export-jobs-browser.json"),
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        passed,
        scope:
          "Actual React/account boundary/native attachment with controlled in-memory HTTP jobs and synthetic cookies; not real DB/worker/provider or full-app layout acceptance.",
        managedIdentityAcceptance: false,
        exactExpectedIds: passed,
        resourceScope:
          "Page JavaScript heap sampled every 10ms; not OS/download-manager or backend memory. Node validates the saved file separately.",
        heapEvidence,
        checks,
        metrics,
        runtimeErrors,
        sourceHashes,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: resolve(out, "workspace-export-jobs-mobile.png"), fullPage: true });
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}
