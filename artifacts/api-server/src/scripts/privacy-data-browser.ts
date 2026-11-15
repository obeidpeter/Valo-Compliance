/** Actual React/download/browser behavior with a controlled API and identities.
 * Not managed sign-in, full privacy fulfilment or production acceptance. */
import {createServer,type ServerResponse} from "node:http";
import {once} from "node:events";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {chromium,expect} from "@playwright/test";
import {developmentPublicationOnly,publicationWorkspaceRoot} from "../editorial/operational-policy";
developmentPublicationOnly();
if(process.env.VALO_RUN_PRIVACY_BROWSER!=="synthetic-development-only")throw Error("EXPLICIT_CONTROLLED_PRIVACY_BROWSER_FLAG_REQUIRED");
const root=publicationWorkspaceRoot(),front=resolve(root,"artifacts/valo");
const code=`
import React from "react";
import {flushSync} from "react-dom";
import {createRoot} from "react-dom/client";
import {AccountStateBoundary} from "./src/components/account-state-boundary";
import {PrivacyPage} from "./src/screens/account";
window.actor="A";
document.cookie="fixture_actor=A; Path=/; SameSite=Lax";
window.fetch=async(url,options={})=>{
 const path=String(url);const actor=window.actor;
 // listPrivacyCases is an array in the actual OpenAPI contract.
 if(path.includes("privacy-cases"))return Response.json([]);
 if(path.includes("/account"))return Response.json({workspaceId:actor,privacyRequests:[]});
  if(path.includes("/data-exports"))return Response.json({items:[],nextCursor:null});
  if(path.includes("/data-export"))throw Error("EXPORT_MUST_USE_NATIVE_ATTACHMENT");
 return Response.json({});
};
const app=createRoot(document.getElementById("root"));
const render=()=>app.render(<AccountStateBoundary identityKey={window.actor}><PrivacyPage/></AccountStateBoundary>);
window.switchActor=(actor)=>{
 if(!["A","B"].includes(actor))throw Error("UNKNOWN_FIXTURE_ACTOR");
 // This is a synthetic cookie, not a managed identity. Update it before the
 // real account boundary unmounts the previous download component.
 document.cookie="fixture_actor="+actor+"; Path=/; SameSite=Lax";
 window.actor=actor;flushSync(render);
};
render();
`;
const built=await build({stdin:{contents:code,resolveDir:front,loader:"tsx"},bundle:true,write:false,
  platform:"browser",jsx:"automatic",alias:{"@":resolve(front,"src")},define:{"process.env":"{}"}});
const html=await(await fetch("http://localhost:80/")).text();
const cssPaths=[...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map(m=>m[1]);
if(!cssPaths.length)throw Error("PRODUCT_CSS_UNAVAILABLE");
const css=(await Promise.all(cssPaths.map(async path=>{
  const r=await fetch(new URL(path,"http://localhost:80"));if(!r.ok)throw Error("PRODUCT_CSS_UNAVAILABLE");return r.text();
}))).join("\n");
let holdExports=false,requestSequence=0;
const waiting=new Map<number,{actor:string;res:ServerResponse}>();
const transport={started:[] as string[],cancelledBeforeHeaders:[] as string[],delivered:[] as string[]};
function sendExport(actor:string,res:ServerResponse){
  if(res.destroyed)return;
  const data={schemaVersion:2,exportedAt:"2026-11-14T12:00:00.000Z",workspaceId:actor,
    scope:"Synthetic application result, not complete privacy fulfilment.",
    data:{fileMetadata:[{id:"FILE_"+actor,size:17}],exportJobs:[{id:"JOB_"+actor,status:"failed"}],yourActivity:[{actorId:actor}]}};
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Content-Disposition",'attachment; filename="valo-workspace-data.json"');
  res.setHeader("X-Content-Type-Options","nosniff");
  res.end(JSON.stringify(data));transport.delivered.push(actor);
}
const server=createServer(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.url==="/__fixture/status"){
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify({...transport,pending:waiting.size}));
  }
  else if(req.url==="/__fixture/control"&&req.method==="POST"){
    let body="";for await(const chunk of req)body+=chunk;
    const command=JSON.parse(body) as {hold:boolean};holdExports=command.hold===true;
    if(!holdExports)for(const[id,pending]of waiting){waiting.delete(id);sendExport(pending.actor,pending.res);}
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify({holding:holdExports,pending:waiting.size}));
  }
  else if(req.url==="/api/workspace/data-export"){
    const actor=/(?:^|;\s*)fixture_actor=([AB])(?:;|$)/.exec(req.headers.cookie??"")?.[1];
    if(!actor){res.statusCode=401;res.setHeader("Content-Type","application/json");res.end(JSON.stringify({error:"A controlled fixture cookie is required."}));return;}
    transport.started.push(actor);
    if(!holdExports){sendExport(actor,res);return;}
    const id=++requestSequence;waiting.set(id,{actor,res});
    res.once("close",()=>{if(waiting.delete(id)&&!res.headersSent)transport.cancelledBeforeHeaders.push(actor);});
  }
  else if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");res.end(built.outputFiles[0].text);}
  else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);}
  else{res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');}
});
server.listen(0,"127.0.0.1");await once(server,"listening");
const address=server.address();if(!address||typeof address==="string")throw Error("NO_FIXTURE_PORT");
const origin=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||"/repl/tools/bin/chromium"});
const context=await browser.newContext({viewport:{width:360,height:800},acceptDownloads:true});
const page=await context.newPage(),checks:string[]=[],downloads:string[]=[],runtimeErrors:string[]=[];
page.on("download",d=>downloads.push(d.suggestedFilename()));
page.on("pageerror",error=>runtimeErrors.push(error.message.slice(0,1000)));
let passed=false;
const out=resolve(root,"generated-artifacts/valo-completion");await mkdir(out,{recursive:true});
try{
   await page.goto(origin);
  await expect(page.getByTestId("workspace-export-scope")).toContainText("export/file metadata");
  await expect(page.getByTestId("workspace-export-scope")).toContainText("not complete privacy fulfilment");
  const button=page.getByTestId("button-download-workspace");
   await page.getByTestId("workspace-export-fallback").locator("summary").click();
  await button.focus();await expect(button).toBeFocused();
  const event=page.waitForEvent("download");await page.keyboard.press("Enter");const download=await event;
  const file=await download.path();if(!file)throw Error("DOWNLOAD_FILE_MISSING");
  const data=JSON.parse(await readFile(file,"utf8"));
  expect(data.schemaVersion).toBe(2);expect(data.workspaceId).toBe("A");
  expect(data.data.fileMetadata[0].id).toBe("FILE_A");
   await expect(page.getByRole("status")).toContainText("Download requested; check browser downloads.");
   await expect(page.locator("body")).not.toContainText("Downloaded. Store it somewhere private.");
   checks.push("360px actual PrivacyPage disclosed scope; keyboard initiated a native cookie-authenticated JSON attachment without app fetch");
   // Attachment completion belongs to the browser. Clear only the page's
   // waiting state before starting a separately controlled pending request.
   await page.getByTestId("button-cancel-workspace-download").click();
   expect((await page.request.post(origin+"/__fixture/control",{data:{hold:true}})).ok()).toBe(true);
   await button.click();
   await expect.poll(async()=>{const r=await page.request.get(origin+"/__fixture/status");return(await r.json()).pending;}).toBe(1);
   await page.evaluate("window.switchActor('B')");
   await expect.poll(async()=>{const r=await page.request.get(origin+"/__fixture/status");return(await r.json()).cancelledBeforeHeaders;}).toEqual(["A"]);
   await expect(page.locator('iframe[title="Workspace data download"]')).toHaveCount(0);
   const released=await page.request.post(origin+"/__fixture/control",{data:{hold:false}});
   expect(released.ok()).toBe(true);expect((await released.json()).pending).toBe(0);
   await page.waitForTimeout(100);
  expect(downloads.length).toBe(1);
   checks.push("Real AccountStateBoundary unmounted A's iframe and aborted its held HTTP request before headers; server release produced no previous-account attachment");
   await page.getByTestId("workspace-export-fallback").locator("summary").click();
   const next=page.waitForEvent("download");await page.getByTestId("button-download-workspace").click();
  const nextFile=await(await next).path();if(!nextFile)throw Error("DOWNLOAD_FILE_MISSING");
  const b=JSON.parse(await readFile(nextFile,"utf8"));expect(b.workspaceId).toBe("B");
   expect(b.data.fileMetadata[0].id).toBe("FILE_B");expect(JSON.stringify(b)).not.toContain("FILE_A");
   expect(transport.started).toEqual(["A","A","B"]);expect(transport.delivered).toEqual(["A","B"]);
   expect(downloads.length).toBe(2);
  expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
   checks.push("Synchronous fixture-cookie/account switch let the next native request download B metadata only; no 360px horizontal page overflow");
  expect(runtimeErrors).toEqual([]);
  passed=true;
}finally{
   const sourceHashes=await Promise.all(["src/screens/account.tsx","src/components/workspace-data-download.tsx","src/components/account-state-boundary.tsx"].map(async path=>({
    path:"artifacts/valo/"+path,sha256:createHash("sha256").update(await readFile(resolve(front,path))).digest("hex")})));
  await writeFile(resolve(out,"privacy-data-browser.json"),JSON.stringify({executedAt:new Date().toISOString(),
     passed,scope:"Controlled API and fixture-cookie identities; actual full PrivacyPage, AccountStateBoundary and native HTTP attachment behavior",managedIdentityAcceptance:false,
     completePrivacyFulfilment:false,checks,runtimeErrors,transport,sourceHashes},null,2)+"\n");
  if(!passed)console.error(JSON.stringify({event:"controlled_privacy_browser_failed",runtimeErrors}));
  await page.screenshot({path:resolve(out,"privacy-data-browser.jpg"),fullPage:true});
   await browser.close();server.closeAllConnections();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));
}


