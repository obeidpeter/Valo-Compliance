import { build } from "esbuild";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const base = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
const dir = await fs.mkdtemp(join(tmpdir(), "valo-support-browser-"));
// Controlled component interactions only. Managed identity and durable database
// behaviour have their own integration tests; all network requests stay local.
const fixtures = {
  workspace: {
    id: "11111111-1111-4111-8111-111111111111",
    reference: "VALO-WORKSPACE-TEST",
    sourceKind: "workspace",
    category: "support",
    status: "open",
    version: 1,
    scope:
      "Complete original request: please inspect the test resource wording and keep this full request available.",
    contactEmail: "customer@example.test",
    sharingConsent: false,
    assignedTo: null,
    updatedAt: "2026-11-15T00:00:00Z",
  },
  access: {
    id: "22222222-2222-4222-8222-222222222222",
    reference: "VALO-ACCESS-TEST",
    sourceKind: "access",
    category: "access",
    status: "open",
    version: 1,
    scope: "Account access test request with the full saved message.",
    contactEmail: "access@example.test",
    sharingConsent: false,
    assignedTo: null,
    updatedAt: "2026-11-15T00:00:00Z",
  },
};
const triageFixture = {
  id: "44444444-4444-4444-8444-444444444444",
  caseId: fixtures.workspace.id,
  reference: fixtures.workspace.reference,
  targetKind: "content",
  targetId: "33333333-3333-4333-8333-333333333333",
  targetVersion: 12,
  targetHash: "exact-referred-version-hash",
  status: "queued",
  reason: "Review the scoped content wording in this specific version.",
  sourceImpactId: null,
  caseVersion: 1,
  createdAt: "2026-11-15T00:00:00Z",
};
let state,
  requests = [],
  failNext = null;
function reset() {
  state = {
    cases: structuredClone(fixtures),
    messages: [],
    events: [],
    escalations: [],
    triage: structuredClone(triageFixture),
  };
  requests = [];
  failNext = null;
}
function result(row, page = 1) {
  return {
    case: row,
    messages: [
      ...(page === 1
        ? state.messages
        : [
            {
              id: "old",
              body: "Older preserved conversation",
              createdAt: "2026-11-14T00:00:00Z",
              authorKind: "customer",
              visibility: "customer",
            },
          ]),
      {
        id: "internal",
        body: "INTERNAL_STAFF_ONLY",
        createdAt: "2026-11-15T00:00:00Z",
        authorKind: "staff",
        visibility: "internal",
      },
    ],
    messagesPage: page,
    messagePageSize: 50,
    moreMessages: page === 1,
    events: state.events,
    escalations: state.escalations,
    eventsTruncated: true,
    escalationsTruncated: true,
    notice: "Saved case history. Portal only; no external delivery.",
  };
}
const handle = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === "/bundle.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(await fs.readFile(dir + "/bundle.js"));
  }
  if (!url.pathname.startsWith("/api/")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
    );
  }
  if (url.pathname.startsWith("/api/admin/support-escalations")) {
    if (req.method === "GET")
      return json(200, {
        escalations: [state.triage],
        page: 1,
        pageSize: 25,
        hasMore: false,
        notice: "Exact version referrals. Triage does not approve publication.",
      });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    requests.push({ url: url.pathname, input });
    if (failNext) {
      const status = failNext;
      failNext = null;
      if (status === 409) state.triage.caseVersion++;
      return json(status, {
        error: status === 409 ? "Referral changed elsewhere." : "Temporary unavailable test.",
      });
    }
    if (input.expectedVersion !== state.triage.caseVersion)
      return json(409, { error: "Wrong expected case version." });
    state.triage.caseVersion++;
    state.triage.status = input.action === "resolve" ? "resolved" : "acknowledged";
    if (input.action === "hold_and_reassess")
      state.triage.sourceImpactId = "55555555-5555-4555-8555-555555555555";
    return json(200, {
      escalation: state.triage,
      caseVersion: state.triage.caseVersion,
      notice: "Triage action saved.",
    });
  }
  if (url.pathname.endsWith("/assignees"))
    return json(200, {
      assignees: [{ identityId: "staff-support-one" }, { identityId: "staff-support-two" }],
    });
  const match = url.pathname.match(/support-cases\/([^/]+)/);
  const row = match ? Object.values(state.cases).find((x) => x.id === match[1]) : null;
  if (req.method === "GET") {
    if (row) return json(200, result(row, Number(url.searchParams.get("messagesPage") || 1)));
    return json(200, {
      cases: url.pathname.includes("/admin/") ? Object.values(state.cases) : [state.cases.workspace],
      page: 1,
      pageSize: 25,
      hasMore: false,
      notice: "Saved requests test queue.",
    });
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks));
  requests.push({ url: url.pathname, input });
  if (failNext) {
    const status = failNext;
    failNext = null;
    if (status === 409) row.version++;
    return json(status, {
      error: status === 409 ? "Case changed elsewhere." : "Temporary unavailable test.",
    });
  }
  if (input.expectedVersion !== row.version) return json(409, { error: "Wrong expected version." });
  row.version++;
  if (url.pathname.endsWith("/reply") || input.action === "reply") {
    state.messages.push({
      id: "message-" + requests.length,
      body: input.body,
      createdAt: "2026-11-15T00:01:00Z",
      authorKind: url.pathname.includes("/admin/") ? "staff" : "customer",
      visibility: row.sourceKind === "access" ? "internal" : "customer",
    });
    row.status = url.pathname.includes("/admin/")
      ? row.sourceKind === "access"
        ? "in_progress"
        : "awaiting_customer"
      : "open";
  } else if (input.action === "assign") {
    row.assignedTo = input.assigneeId;
    row.status = "in_progress";
  } else if (input.action === "resolve") row.status = "resolved";
  else if (input.action === "reopen") row.status = "open";
  else if (input.action === "escalate_content")
    state.escalations.push({
      id: "esc1",
      targetKind: input.targetKind,
      targetId: input.targetId,
      status: "queued",
      reason: input.body,
      createdAt: "2026-11-15T00:01:00Z",
    });
  state.events.push({
    id: "event-" + requests.length,
    action: input.action || "customer_reply",
    actorId: "synthetic-test-actor",
    createdAt: "2026-11-15T00:01:00Z",
  });
  json(200, result(row));
};
// A failure ends this harness with an unhandled rejection, as it did when createServer called
// the async handler directly.
const server = http.createServer((req, res) => void handle(req, res));
const run = async () => {
  await build({
    stdin: {
      contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {CustomerSupportCases} from '${base}/artifacts/valo/src/components/support-cases';import {StaffSupportCases} from '${base}/artifacts/valo/src/components/staff-support-cases';import {ContentEscalations} from '${base}/artifacts/valo/src/components/content-escalations';const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});function App(){const[dirty,setDirty]=useState(false);return <QueryClientProvider client={client}>{location.pathname==='/content'?<><button disabled={dirty}>Other staff area</button><ContentEscalations onDirtyChange={setDirty}/></>:location.pathname==='/staff'?<><button disabled={dirty}>Other staff area</button><StaffSupportCases onDirtyChange={setDirty}/></>:<CustomerSupportCases/>}</QueryClientProvider>}createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: base + "/artifacts/valo",
      loader: "tsx",
    },
    outfile: dir + "/bundle.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    nodePaths: [base + "/artifacts/valo/node_modules", base + "/node_modules"],
    plugins: [
      {
        name: "local-test-aliases",
        setup(b) {
          b.onResolve({ filter: /^@workspace\/api-client-react$/ }, () => ({
            path: base + "/lib/api-client-react/src/index.ts",
          }));
          b.onResolve({ filter: /account-state-boundary$/ }, () => ({ path: "epoch", namespace: "mock" }));
          b.onResolve({ filter: /^(wouter|lucide-react)$/ }, (a) => ({ path: a.path, namespace: "mock" }));
          b.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: "utils", namespace: "mock" }));
          b.onResolve({ filter: /^@\/lib\/api$/ }, () => ({ path: "api", namespace: "mock" }));
          b.onResolve({ filter: /^@\// }, (a) => ({
            path:
              base +
              "/artifacts/valo/src/" +
              a.path.slice(2) +
              (a.path.endsWith("support-case-api") || a.path.endsWith("use-unsaved-navigation")
                ? ".ts"
                : ".tsx"),
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            loader: "tsx",
            resolveDir: base + "/artifacts/valo",
            contents:
              a.path === "epoch"
                ? `export const useAccountEpoch=()=>()=>true;`
                : a.path === "api"
                  ? `export const formatDate=x=>x;export const describeError=e=>({kind:e?.status===403?'forbidden':e?.status===401?'unauthenticated':'server',status:e?.status,message:e?.data?.error||'Unavailable'});`
                  : a.path === "utils"
                    ? `export const cn=(...a)=>a.filter(Boolean).join(' ');`
                    : a.path === "wouter"
                      ? `import React from 'react';export const Link=({href,children,...props})=><a href={href} {...props}>{children}</a>;`
                      : `import React from 'react';export const AlertTriangle=()=>null,CloudOff=()=>null,Lock=()=>null,RefreshCw=()=>null,ShieldAlert=()=>null;`,
          }));
        },
      },
    ],
  });
  reset();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"],
  });
  const checks = [];
  const errors = [];
  let blocked = 0;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : (blocked++, route.abort()),
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(origin + "/customer");
    await page.getByRole("button", { name: "View conversation" }).click();
    await page.getByText(fixtures.workspace.scope, { exact: true }).waitFor();
    assert.equal(await page.getByText("INTERNAL_STAFF_ONLY", { exact: true }).count(), 0);
    checks.push("Customer never renders injected internal messages.");
    await page
      .getByLabel("Add information to this request")
      .fill("Saved customer draft stays while viewing old history.");
    await page.getByRole("button", { name: "Older messages", exact: true }).click();
    await page.getByText("Older preserved conversation", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("Add information to this request").inputValue(),
      "Saved customer draft stays while viewing old history.",
    );
    await page.getByRole("button", { name: "Newer messages", exact: true }).click();
    checks.push("Conversation paging preserves the customer reply draft.");
    failNext = 409;
    await page.getByRole("button", { name: "Save reply to portal", exact: true }).click();
    await page.getByText("This case changed", { exact: true }).waitFor();
    assert(await page.getByRole("button", { name: "Save reply to portal", exact: true }).isDisabled());
    await page.getByRole("button", { name: "Reload latest conversation", exact: true }).click();
    await page.getByRole("button", { name: "Save reply to portal", exact: true }).click();
    await page.getByText("Your reply was saved to this case. It was not emailed.", { exact: true }).waitFor();
    assert.equal(requests[1].input.expectedVersion, 2);
    assert.notEqual(requests[0].input.idempotencyKey, requests[1].input.idempotencyKey);
    checks.push(
      "Conflict blocks writes until explicit reload and resubmits the preserved draft with the new version.",
    );
    await page.getByLabel("Add information to this request").fill("A second reply with uncertain response.");
    failNext = 500;
    await page.getByRole("button", { name: "Save reply to portal", exact: true }).click();
    await page.getByRole("button", { name: "Retry the same reply", exact: true }).waitFor();
    assert(await page.getByLabel("Add information to this request").isDisabled());
    await page.getByRole("button", { name: "Retry the same reply", exact: true }).click();
    await page.getByText("Your reply was saved to this case. It was not emailed.", { exact: true }).waitFor();
    assert.deepEqual(requests[2].input, requests[3].input);
    checks.push("Unknown customer save result locks edits and retries exactly the same idempotent input.");
    reset();
    await page.goto(origin + "/staff");
    await page.getByRole("button", { name: "Open case operations", exact: true }).first().click();
    await page.getByText(fixtures.workspace.scope, { exact: true }).waitFor();
    await page.getByLabel("Operation", { exact: true }).selectOption("assign");
    await page.getByLabel("Active support staff identity", { exact: true }).selectOption("staff-support-one");
    assert(await page.getByRole("button", { name: "Other staff area", exact: true }).isDisabled());
    await page.getByRole("button", { name: "Assign support staff", exact: true }).click();
    await page.getByText("Case operation saved.", { exact: true }).waitFor();
    assert.equal(requests[0].input.assigneeId, "staff-support-one");
    checks.push(
      "Assignment accepts server-listed support identity and dirty state disables staff area switching.",
    );
    await page.getByLabel("Operation", { exact: true }).selectOption("resolve");
    await page.getByLabel("Reason and relevant scope", { exact: true }).fill("Short");
    assert(await page.getByRole("button", { name: "Resolve with a reason", exact: true }).isDisabled());
    await page
      .getByLabel("Reason and relevant scope", { exact: true })
      .fill("Resolved after reviewing the scoped customer question.");
    await page.getByRole("button", { name: "Resolve with a reason", exact: true }).click();
    await page
      .getByText("This case is resolved. Choose “Reopen with a reason” before further operations.", {
        exact: true,
      })
      .waitFor();
    await page.getByLabel("Operation", { exact: true }).selectOption("reopen");
    await page
      .getByLabel("Reason and relevant scope", { exact: true })
      .fill("Reopen to record the authorised content referral.");
    await page.getByRole("button", { name: "Reopen with a reason", exact: true }).click();
    await page.getByText("Case operation saved.", { exact: true }).waitFor();
    checks.push("Resolution requires a reason and resolved cases must reopen before more operations.");
    await page.getByLabel("Operation", { exact: true }).selectOption("escalate_content");
    await page
      .getByLabel("Reason and relevant scope", { exact: true })
      .fill("Please review this scoped test content wording.");
    await page
      .getByLabel("Existing target record UUID", { exact: true })
      .fill("33333333-3333-4333-8333-333333333333");
    await page.getByRole("button", { name: "Queue internal content triage", exact: true }).click();
    await page
      .getByText("Content review was queued. No hold or publication change was made.", { exact: true })
      .waitFor();
    checks.push(
      "Workspace internal triage works without outside-adviser sharing consent and makes no external sharing, publication or hold claim.",
    );
    await page.getByRole("button", { name: "Open case operations", exact: true }).nth(1).click();
    await page.getByText(fixtures.access.scope, { exact: true }).waitFor();
    assert(await page.locator('option[value="escalate_content"]').isDisabled());
    await page
      .getByLabel("Reply text to save internally", { exact: true })
      .fill("Saved staff response for anonymous case, without delivery.");
    await page.getByRole("button", { name: "Save internal reply · no delivery", exact: true }).click();
    await page
      .getByText("Reply saved as an internal record. Nothing was sent to the contact email.", { exact: true })
      .waitFor();
    checks.push(
      "Anonymous case disallows referral and saves a clearly labelled internal reply without email delivery.",
    );
    reset();
    await page.goto(origin + "/content");
    await page.getByRole("button", { name: "Review referred version", exact: true }).click();
    await page.getByText("exact-referred-version-hash", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Referred content version 12", exact: true }).count(),
      1,
    );
    await page.getByLabel("Triage reason and relevant evidence", { exact: true }).fill("Short");
    assert(
      await page
        .getByRole("button", { name: "Hold version and queue reassessment", exact: true })
        .isDisabled(),
    );
    await page
      .getByLabel("Triage reason and relevant evidence", { exact: true })
      .fill("Acknowledge the exact referred version for scoped review.");
    assert(await page.getByRole("button", { name: "Other staff area", exact: true }).isDisabled());
    failNext = 409;
    await page.getByRole("button", { name: "Acknowledge referral", exact: true }).click();
    await page.getByText("This referral changed", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Reload latest referrals", exact: true }).click();
    await page.getByRole("button", { name: "Acknowledge referral", exact: true }).click();
    await page
      .getByText("The content referral was acknowledged. Its publication state is unchanged.", {
        exact: true,
      })
      .waitFor();
    assert.equal(requests[1].input.expectedVersion, 2);
    checks.push(
      "Content staff inspect the exact referred version/hash and reload a conflicted case version without losing their reason.",
    );
    await page
      .getByLabel("Triage reason and relevant evidence", { exact: true })
      .fill("Hold the exact version and queue reassessment without dispatch.");
    failNext = 500;
    await page.getByRole("button", { name: "Hold version and queue reassessment", exact: true }).click();
    await page.getByRole("button", { name: "Retry the same triage operation", exact: true }).waitFor();
    assert(await page.getByLabel("Triage reason and relevant evidence", { exact: true }).isDisabled());
    await page.getByRole("button", { name: "Retry the same triage operation", exact: true }).click();
    await page
      .getByText(
        "The referred version was held and reassessment was queued. No AI work was dispatched and publication was not approved.",
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(requests[2].input, requests[3].input);
    assert(
      await page
        .getByRole("button", { name: "Hold version and queue reassessment", exact: true })
        .isDisabled(),
    );
    await page
      .getByLabel("Triage reason and relevant evidence", { exact: true })
      .fill("Close triage while leaving the source safety hold in place.");
    await page.getByRole("button", { name: "Close content triage", exact: true }).click();
    await page
      .getByText(
        "Content triage was closed. This does not release a hold or establish publication eligibility.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Hold version and queue reassessment", exact: true }).count(),
      0,
    );
    checks.push(
      "Explicit content hold safely retries an uncertain operation, queues reassessment only, and resolved triage exposes no mutations.",
    );
    assert.equal(errors.length, 0);
    assert.equal(blocked, 0);
    const evidence = {
      at: new Date().toISOString(),
      scope:
        "Local component harness with mocked server responses; not live managed-identity or backend integration evidence.",
      passed: checks,
      requests: requests.length,
      browserErrors: errors,
      externalRequests: blocked,
    };
    if (process.env.VALO_SUPPORT_BROWSER_EVIDENCE_PATH)
      await fs.writeFile(process.env.VALO_SUPPORT_BROWSER_EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          scope: "Controlled local component failure; synthetic fixture text only.",
          passed: checks,
          browserErrors: errors,
          pageText: (await page.locator("body").innerText()).slice(0, 6000),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await ctx.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
};
try {
  await run();
} catch (e) {
  console.error(e);
  server.close();
  process.exitCode = 1;
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
