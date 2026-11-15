/** Controlled browser transport test. Uses the real download component and a
 * local HTTP fixture with synthetic cookies/data; no identity provider or DB.
 * Run with tsx. Requires React, esbuild, Playwright and a Chromium executable. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
assert.equal(process.env.NODE_ENV, 'development', 'Run only in the development test environment.');
assert.equal(process.env.VALO_RUN_WORKSPACE_DOWNLOAD_BROWSER, 'synthetic-development-only', 'Explicit synthetic-only browser test opt-in is required.');
const { build } = require('esbuild') as typeof import('esbuild');
const { chromium } = require('playwright') as typeof import('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const evidence = process.env.WORKSPACE_DOWNLOAD_EVIDENCE_DIR ?? join(root, 'generated-artifacts/valo-completion');
const downloadScratch = await mkdtemp(join(tmpdir(), 'valo-download-browser-'));
await mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: { contents: `import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkspaceDataDownload} from ${JSON.stringify(join(root, 'artifacts/valo/src/components/workspace-data-download.tsx'))};
    function Fixture(){const[show,setShow]=useState(true),[account,setAccount]=useState(0);
      return <main><h1>Controlled workspace download</h1>
        {show&&<WorkspaceDataDownload key={account} timeoutMs={Number(new URLSearchParams(location.search).get('timeout'))||120000}/>}
        <hr/><button onClick={()=>setShow(false)}>Unmount download</button>
        <button onClick={()=>setAccount(value=>value+1)}>Change account</button></main>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: 'tsx', resolveDir: join(root, 'artifacts/valo') },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  nodePaths: [join(root, 'artifacts/valo/node_modules'), ...(process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean)],
});
type Mode = 'complete' | 'pending' | 'unauthorized' | 'forbidden' | 'oversized-error';
let mode: Mode = 'complete';
const metrics = { started: 0, completed: 0, cancelledBeforeHeaders: 0, cookieAuthorized: 0 };
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://fixture').pathname;
  if (path === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (path !== '/api/workspace/data-export') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Controlled download test</title><style>body{font:16px system-ui;margin:16px;overflow-wrap:anywhere}main{max-width:600px}button{min-height:44px;margin:4px;padding:8px 12px}p{line-height:1.5}button:focus-visible{outline:3px solid #18583d}</style><div id="root"></div><script src="/fixture.js"></script></html>');
    return;
  }
  metrics.started++;
  const selectedMode = mode;
  const owner = /(?:^|;\s*)fixture-owner=owner-a(?:;|$)/.test(req.headers.cookie ?? '');
  if (owner) metrics.cookieAuthorized++;
  res.setHeader('Cache-Control', 'private, no-store');
  if (!owner || selectedMode === 'unauthorized' || selectedMode === 'forbidden' || selectedMode === 'oversized-error') {
    res.statusCode = selectedMode === 'forbidden' ? 403 : selectedMode === 'oversized-error' ? 500 : 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: selectedMode === 'forbidden' ? 'Workspace access is no longer available.' : selectedMode === 'oversized-error' ? 'SYNTHETIC_PRIVATE_ERROR'.repeat(500) : 'Sign in again to download your workspace.' }));
    return;
  }
  let headersSent = false;
  const timer = setTimeout(() => { void send(); }, selectedMode === 'pending' ? 2000 : 20);
  res.once('close', () => { clearTimeout(timer); if (!headersSent) metrics.cancelledBeforeHeaders++; });
  async function send() {
    if (res.destroyed) return;
    headersSent = true;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="valo-workspace-data.json"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const write = async (chunk: string) => { if (!res.destroyed && !res.write(chunk)) await once(res, 'drain'); };
    try {
      await write('{"schemaVersion":2,"workspaceId":"synthetic-owner-a","data":{"records":[');
      for (let index = 0; index < 6001 && !res.destroyed; index++) await write((index ? ',' : '') + JSON.stringify({ id: index, workspaceId: 'synthetic-owner-a', note: 'x'.repeat(1536) }));
      if (!res.destroyed) { res.end(']}}'); metrics.completed++; }
    } catch { if (!res.destroyed) res.destroy(); }
  }
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>>;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
} catch (error) {
  await writeFile(join(evidence, 'workspace-data-download-browser.json'), JSON.stringify({ passed: false, stage: 'browser startup', error: String(error), checks: [] }, null, 2));
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  await rm(downloadScratch, { recursive: true, force: true });
  throw error;
}
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 375, height: 812 }, isMobile: true });
await context.addCookies([{ name: 'fixture-owner', value: 'owner-a', url: origin, httpOnly: true, sameSite: 'Lax' }]);
await context.addInitScript({content: `
  const guard = (name) => { throw new Error('App attempted forbidden export transport: ' + name); };
  window.fetch = () => guard('fetch');
  window.Blob = new Proxy(window.Blob, { construct: () => guard('Blob') });
  URL.createObjectURL = () => guard('createObjectURL');
  const parse = JSON.parse;
  JSON.parse = (text, reviver) => {
    if (text.includes('"schemaVersion":2') && text.includes('"data"')) return guard('full export JSON parsing');
    return parse(text, reviver);
  };
  const stringify = JSON.stringify;
  JSON.stringify = (value, ...options) => {
    if (value && typeof value === 'object' && 'workspaceId' in value && 'data' in value) return guard('full export JSON stringification');
    return Reflect.apply(stringify, JSON, [value, ...options]);
  };
`});
const page = await context.newPage();
const errors: string[] = [];
let downloads = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('download', () => downloads++);
const waitFor = async (check: () => boolean, label: string) => {
  const until = Date.now() + 5000;
  while (!check() && Date.now() < until) await new Promise(done => setTimeout(done, 25));
  assert.ok(check(), label);
};
const open = async (query = '') => { await page.goto(origin + '/' + query); await page.getByTestId('button-download-workspace').waitFor(); };
const checks: string[] = [];
try {
  await open();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate("document.activeElement?.getAttribute('data-testid')"), 'button-download-workspace');
  const received = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await received;
  assert.equal(download.suggestedFilename(), 'valo-workspace-data.json');
  const downloadedPath = join(downloadScratch, 'synthetic-workspace-data.json');
  await download.saveAs(downloadedPath);
  const raw = await readFile(downloadedPath, 'utf8');
  assert.ok(Buffer.byteLength(raw) > 8_000_000);
  const data = JSON.parse(raw);
  assert.equal(data.data.records.length, 6001);
  assert.equal(new Set(data.data.records.map((row: { id: number }) => row.id)).size, 6001);
  assert.ok(data.data.records.every((row: { workspaceId: string }) => row.workspaceId === 'synthetic-owner-a'));
  assert.doesNotMatch(raw, /storageLocator|another-tenant/);
  assert.match(await page.getByRole('status').innerText(), /Download requested; check browser downloads/);
  assert.doesNotMatch(await page.locator('body').innerText(), /Downloaded\.|Download complete/);
  assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  await page.screenshot({ path: join(evidence, 'workspace-data-download-mobile.png'), fullPage: true });
  checks.push('6001-row >8MB cookie-authenticated native attachment; keyboard activation; mobile width; no app fetch/Blob/object URL/JSON parsing');

  for (const action of ['cancel', 'unmount', 'account', 'reload'] as const) {
    mode = 'pending'; await open();
    const started = metrics.started, cancelled = metrics.cancelledBeforeHeaders;
    await page.getByTestId('button-download-workspace').click();
    await waitFor(() => metrics.started > started, `${action}: request started`);
    if (action === 'cancel') await page.getByTestId('button-cancel-workspace-download').click();
    if (action === 'unmount') await page.getByRole('button', { name: 'Unmount download' }).click();
    if (action === 'account') await page.getByRole('button', { name: 'Change account' }).click();
    if (action === 'reload') await page.reload();
    await waitFor(() => metrics.cancelledBeforeHeaders > cancelled, `${action}: HTTP request aborted before headers`);
    assert.equal(await page.locator('iframe[title="Workspace data download"]').count(), 0);
    checks.push(`${action}: cancelled preparation before attachment headers`);
  }
  mode = 'pending'; await open('?timeout=750');
  const cancelled = metrics.cancelledBeforeHeaders;
  await page.getByTestId('button-download-workspace').click();
  await page.getByRole('status').filter({ hasText: 'Stopped waiting' }).waitFor();
  await waitFor(() => metrics.cancelledBeforeHeaders > cancelled, 'timeout aborts pending preparation');
  checks.push('bounded timeout has no completion claim and aborts preparation');

  for (const denied of ['unauthorized', 'forbidden', 'oversized-error'] as const) {
    mode = denied; await open();
    if (denied === 'unauthorized') await context.clearCookies();
    else await context.addCookies([{ name: 'fixture-owner', value: 'owner-a', url: origin, httpOnly: true, sameSite: 'Lax' }]);
    await page.getByTestId('button-download-workspace').click();
    const alert = page.getByRole('alert'); await alert.waitFor();
    assert.match(await alert.innerText(), denied === 'unauthorized' ? /Sign in again/ : denied === 'forbidden' ? /Workspace access is no longer available/ : /could not be started/);
    assert.doesNotMatch(await page.locator('body').innerText(), /SYNTHETIC_PRIVATE_ERROR/);
    assert.equal(await page.locator('iframe[title="Workspace data download"]').count(), 0);
    assert.equal(await page.getByTestId('button-download-workspace').isEnabled(), true);
    checks.push(`${denied}: bounded readable error, no raw response or download-success claim`);
  }
  await new Promise(done => setTimeout(done, 2100));
  assert.equal(downloads, 1, 'cancelled or denied requests must not produce late downloads');
  assert.deepEqual(errors, []);
  assert.ok(metrics.cookieAuthorized > 0);
  const report = { passed: true, scope: 'Actual component with controlled HTTP/cookie fixture; no production identity, database or full-app layout test.', checks, metrics, downloads, errors };
  await writeFile(join(evidence, 'workspace-data-download-browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidence }, null, 2));
} catch (error) {
  await writeFile(join(evidence, 'workspace-data-download-browser.json'), JSON.stringify({ passed: false, checks, metrics, downloads, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  await context.close(); await browser.close();
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  await rm(downloadScratch, { recursive: true, force: true });
}
