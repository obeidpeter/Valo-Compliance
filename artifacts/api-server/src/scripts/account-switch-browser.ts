/** Actual profile/checker React components; controlled identity/API boundary.
 * Not a real Clerk account-switch, session-revocation or BFCache certification. */
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { developmentPublicationOnly, publicationWorkspaceRoot } from "../editorial/operational-policy";
developmentPublicationOnly();
if (process.env.VALO_RUN_ACCOUNT_SCOPE_BROWSER !== "synthetic-development-only")
  throw Error("EXPLICIT_CONTROLLED_BROWSER_FLAG_REQUIRED");
const root = publicationWorkspaceRoot(),
  front = resolve(root, "artifacts/valo"),
  checks: string[] = [];
const code = `
import React,{useState} from "react";
import{flushSync}from"react-dom";import{createRoot}from"react-dom/client";
import{QueryClient,QueryClientProvider,useMutation}from"@tanstack/react-query";
import{customFetch}from"../../lib/api-client-react/src/custom-fetch";
import{AccountStateBoundary}from"./src/components/account-state-boundary";
import{Toaster}from"./src/components/ui/toaster";
import{useToast}from"./src/hooks/use-toast";
import Profile from"./src/screens/profile";import Checker from"./src/screens/checker";
window.fixtureActor="A";window.submitted=[];window.delayed=[];window.delay=false;window.delayedPosts=[];window.delayPosts=false;
window.staleCallbacks=[];window.deferredSends=[];window.unauthorized=false;
const profile=(actor)=>({businessName:"PRIVATE_"+actor,legalForm:actor==="A"?"limited_company":"unknown",registrationStatus:"unknown",
 activities:["ACTIVITY_PRIVATE_"+actor],state:"unknown",lga:"PRIVATE_LGA_"+actor,employees:"unknown",
 turnoverBand:"unknown",turnoverYear:"unknown",turnoverMetric:"unknown",turnoverCurrency:"NGN",
 premises:"unknown",manufacturing:"unknown",importing:"unknown",personalData:"unknown",marketingConsent:false});
const workspace=(actor)=>({id:actor,profile:profile(actor),profileRevision:actor==="B"?8:3,profileVersionId:null});
window.fetch=async(url,options={})=>{
 const actor=window.fixtureActor,body=options.body?JSON.parse(options.body):null;
 if(window.unauthorized)return Response.json({},{status:401});
 if(options.method&&options.method!=="GET"){
   window.submitted.push({actor,url:String(url),body});
   if(window.delayPosts)return new Promise(resolve=>window.delayedPosts.push(()=>resolve(Response.json({...workspace(actor),profile:body?.profile,profileRevision:9}))));
   return Response.json({...workspace(actor),profile:body?.profile??profile(actor),profileRevision:9});
 }
 if(window.delay)return new Promise(resolve=>window.delayed.push({actor,resolve:()=>resolve(Response.json(workspace(actor)))}));
 return Response.json(workspace(actor));
};
const legacy=new QueryClient({defaultOptions:{queries:{retry:false}}});
function MutationProbe(){
 const{toast}=useToast();window.keepLateToast=()=>{window.lateToast=()=>toast({title:"LATE_PRIVATE_A"});};
 const mutation=useMutation({mutationFn:()=>customFetch("/api/controlled",{method:"POST",body:JSON.stringify({name:"UNSENT_PRIVATE_A"})}),
   onMutate:()=>new Promise(resolve=>window.deferredSends.push(resolve)),
   onSuccess:()=>window.staleCallbacks.push("STALE_PRIVATE_A")});
 window.deferMutation=()=>mutation.mutate();return null;
}
function Fixture(){
 const[state,setState]=useState({actor:"A",view:"profile",legacy:true});
 window.transition=(next)=>{window.fixtureActor=next.actor;legacy.clear();flushSync(()=>setState(next));};
 const child=state.view==="checker"?<Checker/>:state.actor==="anonymous"?<h1>Signed out</h1>:<Profile/>;
 return state.legacy?<QueryClientProvider client={legacy}>{child}<Toaster/></QueryClientProvider>:
  <AccountStateBoundary identityKey={state.actor+"/test-session"}><MutationProbe/>{child}<Toaster/></AccountStateBoundary>;
}createRoot(document.getElementById("root")).render(<Fixture/>);
`;
const result = await build({
  stdin: { contents: code, loader: "tsx", resolveDir: front },
  absWorkingDir: front,
  bundle: true,
  write: false,
  outdir: "generated-account-fixture",
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve(front, "src") },
  define: { "process.env": "{}" },
  plugins: [
    {
      name: "controlled-clerk-only-in-this-test",
      setup(build) {
        build.onResolve({ filter: /^@clerk\/react$/ }, () => ({
          path: "identity",
          namespace: "controlled-clerk",
        }));
        build.onLoad({ filter: /.*/, namespace: "controlled-clerk" }, () => ({
          contents:
            "export function useUser(){return{isSignedIn:window.fixtureActor!=='anonymous',isLoaded:true,user:null}}",
          loader: "js",
        }));
      },
    },
  ],
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js"))!.contents;
// Use the real Next/PostCSS output, not unprocessed Tailwind directives which
// would make a reflow result meaningless.
let css: string;
if (process.env.CI === "true") {
  const directory = resolve(front, ".next/static/css"),
    files = (await readdir(directory, { recursive: true })).filter((p) => p.endsWith(".css"));
  if (!files.length) throw Error("BUILT_PRODUCT_CSS_REQUIRED");
  css = (await Promise.all(files.map((p) => readFile(resolve(directory, p), "utf8")))).join("\n");
} else {
  const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`,
    html = await (await fetch(origin, { redirect: "error" })).text();
  const stylePaths = [...html.matchAll(/href="([^"]+\.css(?:\?[^"]*)?)"/g)]
    .map((m) => m[1])
    .filter((p) => p?.startsWith("/_next/"));
  if (!stylePaths.length) throw Error("COMPILED_PRODUCT_CSS_REQUIRED");
  css = (
    await Promise.all(
      stylePaths.map(async (path) => {
        const response = await fetch(origin + path, { redirect: "error" });
        if (!response.ok) throw Error("COMPILED_PRODUCT_CSS_FETCH_FAILED");
        return response.text();
      }),
    )
  ).join("\n");
}
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
if (!address || typeof address === "string") throw Error("NO_TEST_PORT");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium",
});
const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
const page = await context.newPage();
const transition = async (actor: string, view = "profile", legacy = false) =>
  page.evaluate(`window.transition(${JSON.stringify({ actor, view, legacy })})`);
const report: { [key: string]: unknown } = {
  startedAt: new Date().toISOString(),
  controlledIdentity: true,
  controlledApi: true,
  realClerkSessions: 0,
  compiledProductCssSha256: createHash("sha256").update(css).digest("hex"),
  actualComponents: ["screens/profile.tsx", "screens/checker.tsx", "components/account-state-boundary.tsx"],
  checks,
};
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  const name = page.getByTestId("input-business-name");
  await expect(name).toHaveValue("PRIVATE_A");
  await transition("B", "profile", true);
  await expect(name).toHaveValue("PRIVATE_A");
  checks.push("Legacy cache-only control reproduced copied A form state after identity B");
  await transition("A");
  await expect(name).toHaveValue("PRIVATE_A");
  await name.fill("UNSAVED_PRIVATE_A");
  await transition("B");
  await expect(name).toHaveValue("PRIVATE_B");
  await expect(page.locator("body")).not.toContainText("UNSAVED_PRIVATE_A");
  expect(await page.locator('input[value*="PRIVATE_A"]').count()).toBe(0);
  checks.push("Identity remount removed old profile fields before B form use");
  await name.fill("PRIVATE_B_EDIT");
  await page.getByTestId("button-save-profile").click();
  await expect.poll(() => page.evaluate("window.submitted.length")).toBe(1);
  await expect(page.getByText("Profile saved", { exact: true })).toBeVisible();
  expect(JSON.stringify(await page.evaluate("window.submitted"))).not.toContain("PRIVATE_A");
  checks.push("B profile submission contained no A form marker");
  await transition("A");
  await name.fill("UNSAVED_SAME_ACCOUNT_A");
  await transition("A");
  await expect(name).toHaveValue("UNSAVED_SAME_ACCOUNT_A");
  const beforeNavigation = page.url();
  await page.evaluate("history.pushState({},'', '/another-screen')");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(page.url()).toBe(beforeNavigation);
  await page.getByTestId("button-stay-editor").click();
  await expect(name).toHaveValue("UNSAVED_SAME_ACCOUNT_A");
  checks.push("Same-account rerender and cancelled routed navigation preserved unsaved profile");
  await page.evaluate("window.delayPosts=true;window.keepLateToast()");
  await page.getByTestId("button-save-profile").click();
  await expect.poll(() => page.evaluate("window.delayedPosts.length")).toBe(1);
  await transition("B");
  await expect(name).toHaveValue("PRIVATE_B");
  await page.evaluate(
    "window.delayPosts=false;for(const resolve of window.delayedPosts)resolve();window.lateToast()",
  );
  await expect(name).toHaveValue("PRIVATE_B");
  checks.push("Late A save response after B switch did not update B profile or show saved toast");
  await expect(page.locator("body")).not.toContainText("Profile saved");
  await expect(page.locator("body")).not.toContainText("LATE_PRIVATE_A");
  await transition("A");
  const beforeDeferred = await page.evaluate("window.submitted.length");
  await page.evaluate("window.deferMutation()");
  await expect.poll(() => page.evaluate("window.deferredSends.length")).toBe(1);
  await transition("B");
  await page.evaluate("for(const resolve of window.deferredSends)resolve()");
  await page.waitForTimeout(150);
  expect(await page.evaluate("window.submitted.length")).toBe(beforeDeferred);
  expect(await page.evaluate("window.staleCallbacks")).toEqual([]);
  checks.push("Mutation paused before dispatch was discarded, with zero sends, after account switch");
  await page.evaluate("window.delay=true");
  await transition("A");
  await expect.poll(() => page.evaluate("window.delayed.length")).toBeGreaterThan(0);
  await page.evaluate("window.delay=false");
  await transition("B");
  await expect(name).toHaveValue("PRIVATE_B");
  await page.evaluate("for(const item of window.delayed)item.resolve()");
  await expect(name).toHaveValue("PRIVATE_B");
  checks.push("Late old-account workspace response could not repopulate B form/cache");
  await transition("A", "checker");
  await page.getByTestId("button-prefill").click();
  await expect(page.locator('input[name="legalForm"][value="limited_company"]')).toBeChecked();
  await transition("anonymous", "checker");
  await expect(page.locator('input[name="legalForm"][value="limited_company"]')).not.toBeChecked();
  checks.push("Public checker copied facts reset on controlled sign-out");
  const peer = await page.context().newPage();
  await peer.goto(`http://127.0.0.1:${address.port}`);
  await peer.evaluate("window.transition({actor:'A',view:'profile',legacy:false})");
  await expect(peer.getByTestId("input-business-name")).toHaveValue("PRIVATE_A");
  await transition("A", "checker");
  await page.getByTestId("button-prefill").click();
  await expect(page.locator('input[name="legalForm"][value="limited_company"]')).toBeChecked();
  await peer.evaluate("window.transition({actor:'anonymous',view:'profile',legacy:false})");
  await expect(page.getByRole("alert")).toContainText("session ended or changed");
  await expect(page.locator('input[name="legalForm"]')).toHaveCount(0);
  checks.push("Actual cross-tab BroadcastChannel session-end cleared an open prefilled public checker");
  await transition("B");
  await expect(name).toHaveValue("PRIVATE_B");
  await peer.evaluate("window.transition({actor:'B',view:'profile',legacy:false})");
  await expect(peer.getByTestId("input-business-name")).toHaveValue("PRIVATE_B");
  await peer.getByTestId("input-business-name").fill("UNSAVED_PRIVATE_B");
  await transition("anonymous", "checker");
  await expect(peer.getByRole("alert")).toContainText("session ended or changed");
  await expect(peer.getByTestId("input-business-name")).toHaveCount(0);
  await expect(peer.locator("body")).not.toContainText("UNSAVED_PRIVATE_B");
  checks.push("Actual cross-tab session-end removed private profile and unsaved fields");
  await peer.close();
  await transition("A");
  await expect(name).toHaveValue("PRIVATE_A");
  await name.fill("PRIVATE_A_BEFORE_401");
  await page.evaluate("window.unauthorized=true");
  await page.getByTestId("button-save-profile").click();
  await expect(page.getByRole("alert")).toContainText("session ended or changed");
  await expect(name).toHaveCount(0);
  await page.evaluate("window.unauthorized=false");
  await transition("B");
  await expect(name).toHaveValue("PRIVATE_B");
  checks.push("Current API session loss scrubbed mounted private form before another workspace could use it");
  await transition("B");
  await expect(name).toHaveValue("PRIVATE_B");
  await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))");
  await expect(name).toHaveCount(0);
  await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false}))");
  await expect(name).toHaveValue("PRIVATE_B");
  checks.push("Controlled page lifecycle scrubbed private subtree and reloaded fresh form state");
  expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
  await page.getByTestId("input-business-name").focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate("document.activeElement?.tagName")).toBe("SELECT");
  checks.push("360px profile reflow and native keyboard focus advance passed");
  report.status = "passed_controlled_component_regression_not_real_identity_acceptance";
} catch (error) {
  report.status = "failed";
  report.failure = error instanceof Error ? error.message.slice(0, 1500) : "BROWSER_CASE_FAILED";
  process.exitCode = 1;
} finally {
  const paths = [
    "src/components/account-state-boundary.tsx",
    "src/components/account-epoch-context.ts",
    "src/hooks/use-toast.ts",
    "src/App.tsx",
    "src/screens/profile.tsx",
    "src/screens/checker.tsx",
  ];
  report.sourceHashes = await Promise.all(
    paths.map(async (path) => ({
      path: `artifacts/valo/${path}`,
      sha256: createHash("sha256")
        .update(await readFile(resolve(front, path)))
        .digest("hex"),
    })),
  );
  const out = resolve(root, "generated-artifacts/valo-completion");
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, "account-switch-browser.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(
    resolve(out, `account-switch-browser-${Date.now()}.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
  await page.screenshot({ path: resolve(out, "account-switch-browser.jpg"), fullPage: true });
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  console.log(JSON.stringify(report, null, 2));
}
