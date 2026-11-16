/** Actual role administration component and private request-scope boundary.
 * Controlled API/identity only: this script cannot grant real managed roles. */
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { developmentPublicationOnly, publicationWorkspaceRoot } from "../editorial/operational-policy";
developmentPublicationOnly();
if (process.env.VALO_RUN_STAFF_ROLE_BROWSER !== "synthetic-development-only" || process.env.CI !== "true")
  throw Error("CONTROLLED_CI_BROWSER_REQUIRED");
const root = publicationWorkspaceRoot(),
  front = resolve(root, "artifacts/valo"),
  checks: string[] = [];
const code = `import React,{useState} from "react";import{flushSync}from"react-dom";import{createRoot}from"react-dom/client";
import{AccountStateBoundary}from"./src/components/account-state-boundary";import{StaffRoleAdministration}from"./src/components/staff-role-administration";
window.actor="A";window.requests=[];window.saved=null;window.applied=0;window.failAfterSave=true;window.assignments=[];window.changes=[];
window.fetch=async(input,options={})=>{const url=String(input),method=options.method||"GET",body=options.body?JSON.parse(options.body):null;if(!url.startsWith("/api/admin/staff-role"))throw Error("UNEXPECTED_REQUEST");window.requests.push({url,method,body});
 if(window.actor!=="A")return Response.json({error:"A permanent system role and recent MFA are required."},{status:403});
 if(url==="/api/admin/staff-role-target")return Response.json({identityId:body.identityId,label:"CONTROLLED_TARGET@example.invalid",verifiedAt:new Date().toISOString()});
 if(method==="GET")return Response.json({assignments:window.assignments,changes:window.changes,notice:"Controlled role interface; no real identity or role change."});
 if(!window.saved){window.applied++;const now=new Date().toISOString(),assignment={id:"11111111-1111-4111-8111-111111111111",identityId:body.identityId,role:body.role,active:true,grantMode:body.grantMode,expiresAt:new Date(Date.now()+body.durationMinutes*60000).toISOString(),version:1,grantedBy:"user_controlled_operator",grantedAt:now,reason:body.reason};window.assignments=[assignment];window.saved={id:"22222222-2222-4222-8222-222222222222",requestKey:body.requestKey,actorId:"user_controlled_operator",assignmentId:assignment.id,targetIdentityId:body.identityId,action:body.action,role:body.role,reason:body.reason,incidentReference:body.incidentReference,before:null,after:assignment,createdAt:now};window.changes=[window.saved];}
 if(window.failAfterSave){window.failAfterSave=false;return Response.json({error:"Controlled lost acknowledgement after save"},{status:503});}return Response.json(window.saved);
};
function Fixture(){const[epoch,setEpoch]=useState(0);window.transition=actor=>{window.actor=actor;flushSync(()=>setEpoch(x=>x+1));};return <AccountStateBoundary identityKey={window.actor+"/"+epoch}><main style={{maxWidth:900,margin:"auto",padding:16}}><StaffRoleAdministration/></main></AccountStateBoundary>;}createRoot(document.getElementById("root")).render(<Fixture/>);`;
const result = await build({
    stdin: { contents: code, loader: "tsx", resolveDir: front },
    absWorkingDir: front,
    bundle: true,
    write: false,
    outdir: "generated-staff-fixture",
    format: "iife",
    jsx: "automatic",
    alias: { "@": resolve(front, "src") },
    define: { "process.env": "{}" },
  }),
  js = result.outputFiles.find((f) => f.path.endsWith(".js"))!.contents;
const cssRoot = resolve(front, ".next/static/css"),
  files = (await readdir(cssRoot, { recursive: true })).filter((p) => p.endsWith(".css"));
if (!files.length) throw Error("BUILT_PRODUCT_CSS_REQUIRED");
const css = (await Promise.all(files.map((p) => readFile(resolve(cssRoot, p), "utf8")))).join("\n");
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
  } else if (req.url === "/fixture.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
  } else
    res.end(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>',
    );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw Error("NO_PORT");
const origin = "http://127.0.0.1:" + address.port;
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  }),
  context = await browser.newContext({ viewport: { width: 360, height: 800 } }),
  page = await context.newPage(),
  external: string[] = [];
await context.route("**/*", (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
const report: Record<string, unknown> = {
  checks,
  controlledApi: true,
  controlledIdentity: true,
  realRoleChanges: 0,
};
try {
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Staff permission administration", exact: true }),
  ).toBeVisible();
  const save = page.getByRole("button", { name: "Save authorised role change", exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel("Managed identity ID", { exact: true }).fill("user_controlled_target");
  await page.getByLabel("Incident reference", { exact: true }).fill("CONTROLLED-INCIDENT");
  await page
    .getByLabel("Reason for the change", { exact: true })
    .fill("CONTROLLED_REASON reviewed emergency support access");
  await page.getByRole("checkbox").check();
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Verify selected identity", exact: true }).click();
  await expect(page.getByText("Verified target:", { exact: false })).toContainText("CONTROLLED_TARGET");
  await expect(save).toBeEnabled();
  checks.push(
    "Grant requires explicit acknowledgement and exact server-verified target before enabling save",
  );
  await page.getByLabel("Minutes until expiry", { exact: true }).fill("20");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox").check();
  checks.push("Editing emergency duration invalidates the exact reviewed acknowledgement");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("saved outcome may be unknown");
  const retry = page.getByRole("button", { name: "Retry exact saved role change", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page.getByLabel("Managed identity ID", { exact: true })).toBeDisabled();
  await retry.click();
  await expect(page.getByRole("status")).toContainText("Role change saved:");
  const sent = await page.evaluate(() =>
    (globalThis as any).requests
      .filter((r: any) => r.url === "/api/admin/staff-roles" && r.method === "POST")
      .map((r: any) => r.body),
  );
  expect(sent).toHaveLength(2);
  expect(sent[0]).toEqual(sent[1]);
  expect(await page.evaluate(() => (globalThis as any).applied)).toBe(1);
  expect(sent[0].durationMinutes).toBe(20);
  expect(sent[0].acknowledgement).toBe(true);
  checks.push(
    "Lost acknowledgement preserves immutable payload and request key for one controlled application; retry does not create a fresh grant",
  );
  await expect(page.getByRole("heading", { name: "Recent role-change alerts", exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("CONTROLLED-INCIDENT");
  await page.getByLabel("Managed identity ID", { exact: true }).focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => (globalThis as any).document.activeElement?.tagName)).toBe("SELECT");
  expect(
    await page.evaluate(
      () => (globalThis as any).document.documentElement.scrollWidth <= (globalThis as any).innerWidth,
    ),
  ).toBe(true);
  checks.push("Role-change alert, keyboard controls and 360px compiled-product reflow are usable");
  await page.evaluate(() => (globalThis as any).transition("B"));
  await expect(page.getByRole("alert")).toContainText("permanent system role");
  await expect(page.getByLabel("Managed identity ID", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("CONTROLLED_TARGET");
  await expect(page.locator("body")).not.toContainText("CONTROLLED_REASON");
  checks.push("Account transition clears saved target, reason, history and mutation controls");
  expect(external).toEqual([]);
  report.status = "passed_controlled_ui_not_managed_role_acceptance";
} catch (error) {
  report.status = "failed";
  report.failure = error instanceof Error ? error.message.slice(0, 1500) : "BROWSER_FAILED";
  process.exitCode = 1;
} finally {
  const out = resolve(root, "generated-artifacts/valo-completion");
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, "staff-role-browser.json"), JSON.stringify(report, null, 2) + "\n");
  await page.screenshot({ path: resolve(out, "staff-role-browser.jpg"), fullPage: true });
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  console.log(JSON.stringify(report));
}
