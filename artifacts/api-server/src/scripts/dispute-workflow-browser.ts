/** Actual dispute React components and guarded generated client; controlled HTTP/identity.
 * This does not exercise Clerk, a merchant account, database authority or Paystack. */
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdir,writeFile,readFile,readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {build} from "esbuild";
import {chromium,expect} from "@playwright/test";
import {developmentPublicationOnly,publicationWorkspaceRoot} from "../editorial/operational-policy";
developmentPublicationOnly();
if(process.env.VALO_RUN_DISPUTE_BROWSER!=="synthetic-development-only")throw Error("EXPLICIT_CONTROLLED_BROWSER_FLAG_REQUIRED");
const root=publicationWorkspaceRoot(),front=resolve(root,"artifacts/valo"),checks:string[]=[];
const code=`
import React,{useState} from "react";import{flushSync}from"react-dom";import{createRoot}from"react-dom/client";
import{AccountStateBoundary}from"./src/components/account-state-boundary";
import{PaymentConcerns}from"./src/components/payment-concerns";
import{FinanceDisputes}from"./src/screens/finance-disputes";
const orderId="11111111-1111-4111-8111-111111111111",workflowId="22222222-2222-4222-8222-222222222222";
const concernId="33333333-3333-4333-8333-333333333333",now="2026-11-15T12:00:00.000Z";
window.requests=[];window.fixtureActor="A";window.unauthorized=false;window.forbidden=false;window.delayMutation=false;window.delayed=[];window.nextIntent=1;
window.fixture={executionEnabled:false,concerns:[],intents:[],history:[],version:1};
const workflow=()=>({id:workflowId,orderId,orderReference:"CONTROLLED-ORDER-A",orderTitle:"Controlled test licence",orderAmountKobo:10000,
providerId:"90001",canonicalStatus:"awaiting-merchant-feedback",providerResolution:null,providerAmountKobo:null,category:"chargeback",
entitlementStatus:"suspended",held:false,version:window.fixture.version,checkedAt:now,createdAt:now});
const detail=()=>({workflow:workflow(),intents:window.fixture.intents,history:window.fixture.history,executionEnabled:window.fixture.executionEnabled,notice:"Controlled test workflow. No merchant calls."});
function event(action,reason,actorType="finance"){return{id:crypto.randomUUID(),action,reason,actorType,createdAt:now};}
window.fetch=async(input,options={})=>{
 const url=String(input),method=(options.method||"GET").toUpperCase(),body=options.body?JSON.parse(options.body):null;
 if(!url.startsWith("/api/"))throw Error("UNEXPECTED_OUTBOUND_REQUEST");
 window.requests.push({url,method,body,actor:window.fixtureActor});
 if(window.unauthorized)return Response.json({error:"Controlled session ended"},{status:401});
 if(window.forbidden&&url.startsWith("/api/admin/"))return Response.json({error:"Active finance permission and recent MFA required."},{status:403});
 if(url==="/api/workspace/disputes"&&method==="GET")return Response.json({concerns:window.fixtureActor==="A"?window.fixture.concerns:[],workflows:[],notice:"Concerns are not bank disputes."});
 if(url===\`/api/workspace/orders/\${orderId}/concerns\`&&method==="POST"){
   const saved={id:concernId,orderId,orderReference:"CONTROLLED-ORDER-A",message:body.message,status:"open",latestReply:null,version:1,createdAt:now,updatedAt:now,history:[event("created",body.message,"customer")]};
   window.fixture.concerns=[saved];
   if(window.delayMutation)return new Promise(resolve=>window.delayed.push(()=>resolve(Response.json(saved))));
   return Response.json(saved);
 }
 if(url===\`/api/workspace/concerns/\${concernId}/respond\`&&method==="POST"){
   const row=window.fixture.concerns[0];row.version++;row.history.push(event("customer_reply",body.message,"customer"));return Response.json(row);
 }
 if(url==="/api/admin/disputes"&&method==="GET")return Response.json({concerns:window.fixture.concerns,workflows:[workflow()],observations:[],executionEnabled:window.fixture.executionEnabled,notice:"Controlled test queue; provider execution starts disabled."});
 if(url===\`/api/admin/disputes/\${workflowId}\`&&method==="GET")return Response.json(detail());
 if(url===\`/api/admin/disputes/\${workflowId}/action\`&&method==="POST"){
   window.fixture.version++;window.fixture.history.push(event(body.action,body.reason));
   if(body.action.startsWith("prepare_")){
     const number=window.nextIntent++,id="44444444-4444-4444-8444-"+String(number).padStart(12,"0");
     window.fixture.intents.push({id,operation:body.action==="prepare_receipt"?"receipt_upload":body.action==="prepare_evidence"?"evidence":"resolve",
       state:"prepared",inputHash:"a".repeat(64),sourceReference:"CONTROLLED-ORDER-A/version-1",summary:body.action==="prepare_decision"?"Proposed "+body.resolution+" for "+body.amountKobo+" kobo":"Saved controlled order receipt",
       facts:[{label:"Order reference",value:"CONTROLLED-ORDER-A"}],createdAt:now,attemptedAt:null,acknowledgedAt:null,providerFilename:null,providerEvidenceId:null,failure:null,receiptUrl:null});
   }else if(body.action==="dispatch_intent"){
     const intent=window.fixture.intents.find(item=>item.id===body.intentId);intent.state="unknown";intent.attemptedAt=now;intent.failure="PROVIDER_OUTCOME_UNKNOWN";
   }else if(body.action==="cancel_intent")window.fixture.intents.find(item=>item.id===body.intentId).state="cancelled";
   return Response.json(detail());
 }
 if(url===\`/api/admin/payment-concerns/\${concernId}/action\`&&method==="POST"){
   const row=window.fixture.concerns[0];row.version++;row.latestReply=body.message;row.status=body.action==="close"?"closed":body.action==="request_information"?"needs_information":"responded";
   row.history.push(event(body.action,body.message));return Response.json(row);
 }
 throw Error("UNHANDLED_CONTROLLED_REQUEST: "+method+" "+url);
};
function Fixture(){const[state,setState]=useState({actor:"A",view:"customer",epoch:0});
 window.transition=(actor,view)=>{window.fixtureActor=actor;flushSync(()=>setState(s=>({actor,view,epoch:s.epoch+1})));};
 return <AccountStateBoundary identityKey={state.actor+"/controlled-"+state.epoch}><main style={{maxWidth:900,margin:"auto",padding:20}}>
 {state.view==="customer"?<PaymentConcerns orderId={orderId} orderReference="CONTROLLED-ORDER-A"/>:<FinanceDisputes/>}</main></AccountStateBoundary>;
}createRoot(document.getElementById("root")).render(<Fixture/>);
`;
const result=await build({stdin:{contents:code,loader:"tsx",resolveDir:front},absWorkingDir:front,bundle:true,write:false,
  outdir:"generated-dispute-fixture",format:"iife",jsx:"automatic",alias:{"@":resolve(front,"src")},define:{"process.env":"{}"}});
const js=result.outputFiles.find(f=>f.path.endsWith(".js"))!.contents;
let css:string;
if(process.env.CI==="true"){
  const directory=resolve(front,".next/static/css"),files=(await readdir(directory,{recursive:true})).filter(p=>p.endsWith(".css"));
  if(!files.length)throw Error("BUILT_PRODUCT_CSS_REQUIRED");
  css=(await Promise.all(files.map(p=>readFile(resolve(directory,p),"utf8")))).join("\n");
}else{
  if(!process.env.REPLIT_DEV_DOMAIN)throw Error("COMPILED_PRODUCT_CSS_OR_CI_BUILD_REQUIRED");
  const origin=`https://${process.env.REPLIT_DEV_DOMAIN}`,html=await(await fetch(origin,{redirect:"error"})).text();
  const paths=[...html.matchAll(/href="([^"]+\.css(?:\?[^"]*)?)"/g)].map(m=>m[1]).filter(p=>p?.startsWith("/_next/"));
  if(!paths.length)throw Error("COMPILED_PRODUCT_CSS_REQUIRED");
  css=(await Promise.all(paths.map(async path=>{const response=await fetch(origin+path,{redirect:"error"});if(!response.ok)throw Error("COMPILED_PRODUCT_CSS_FETCH_FAILED");return response.text();}))).join("\n");
}
const server=createServer((req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");res.end(js);}
  else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);}
  else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
});
server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw Error("NO_TEST_PORT");
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||"/repl/tools/bin/chromium"});
const context=await browser.newContext({viewport:{width:360,height:800}}),page=await context.newPage();
const externalRequests:string[]=[];
await context.route("**/*",route=>{const url=new URL(route.request().url());if(url.origin===`http://127.0.0.1:${address.port}`)return route.continue();externalRequests.push(url.origin);return route.abort();});
const report:Record<string,unknown>={startedAt:new Date().toISOString(),controlledIdentity:true,controlledApi:true,realClerkSessions:0,merchantCalls:0,
  compiledProductCssSha256:createHash("sha256").update(css).digest("hex"),actualComponents:["components/payment-concerns.tsx","screens/finance-disputes.tsx","components/account-state-boundary.tsx"],checks};
const transitions=async(actor:string,view:string)=>page.evaluate(({actor,view})=>(window as any).transition(actor,view),{actor,view});
const calls=async(action:string)=>page.evaluate(action=>(window as any).requests.filter((row:any)=>row.body?.action===action).length,action);
try{
  await page.goto(`http://127.0.0.1:${address.port}`);
  await expect(page.getByText("No concerns saved for this order.")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByText("Saving a concern does not open a bank dispute",{exact:false})).toBeVisible();
  const concern=page.getByLabel("What happened with this order?");await concern.fill("CONTROLLED_CUSTOMER_A payment concern");
  await expect(page.getByRole("button",{name:"Save payment concern",exact:true})).toBeDisabled();
  await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Save payment concern",exact:true}).click();
  await expect(page.getByText("Concern saved. Your reference is",{exact:false})).toContainText("33333333-3333-4333-8333-333333333333");
  const firstBody=await page.evaluate(()=>(window as any).requests.find((row:any)=>row.url.endsWith("/concerns")&&row.method==="POST").body);
  expect(firstBody).toMatchObject({message:"CONTROLLED_CUSTOMER_A payment concern",acknowledgement:true});expect(firstBody.providerId).toBeUndefined();
  checks.push("Customer concern requires acknowledgement, saves a durable reference, and sends no provider dispute identifier");
  await page.getByText("Replies and history",{exact:true}).click();
  await page.getByLabel("Add information to this concern").fill("CONTROLLED_ADDITIONAL_INFORMATION");
  await page.getByRole("button",{name:"Save reply",exact:true}).click();
  await expect(page.getByText("CONTROLLED_ADDITIONAL_INFORMATION",{exact:true})).toBeVisible();
  checks.push("Customer reply persists in chronological concern history through a separate versioned request");
  await concern.fill("UNSAVED_PRIVATE_CONCERN_A");await transitions("B","customer");
  await expect(concern).toHaveValue("");await expect(page.locator("body")).not.toContainText("CONTROLLED_CUSTOMER_A");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  checks.push("Account boundary clears customer concern history, unsaved text and acknowledgement on identity switch");
  await transitions("A","customer");await concern.fill("LATE_PRIVATE_CONCERN_A");await page.getByRole("checkbox").check();
  await page.evaluate(()=>(window as any).delayMutation=true);await page.getByRole("button",{name:"Save payment concern",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).delayed.length)).toBe(1);await transitions("B","customer");
  await page.evaluate(()=>{(window as any).delayMutation=false;for(const resolve of (window as any).delayed)resolve();});
  await expect(concern).toHaveValue("");await expect(page.locator("body")).not.toContainText("Concern saved. Your reference is");
  checks.push("Late concern response from an old account cannot populate the new account or show its saved reference");
  await transitions("finance","finance");await page.getByRole("button",{name:"Review dispute 90001"}).click();
  await expect(page.getByRole("heading",{name:"Finance dispute review"})).toBeVisible();
  await page.getByLabel("Reason for the next finance action").fill("Verified controlled order and payment evidence");
  await page.getByText("Prepare evidence and a merchant decision",{exact:true}).click();
  await expect(page.getByRole("button",{name:"Prepare receipt from saved order"})).toBeDisabled();
  await page.getByRole("checkbox",{name:/I confirm that any supplied facts/}).check();
  await page.getByRole("button",{name:"Prepare receipt from saved order"}).click();
  await expect(page.getByText("Intent saved for review. No provider operation was sent.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Dispatch this test operation",exact:true})).toBeDisabled();
  expect(await calls("prepare_receipt")).toBe(1);expect(await calls("dispatch_intent")).toBe(0);
  checks.push("Disabled provider state permits immutable preparation but prevents dispatch and does not imply a sent operation");
  await page.evaluate(()=>(window as any).fixture.executionEnabled=true);await page.getByRole("button",{name:"Reload saved dispute record",exact:true}).click();
  const ack=page.getByRole("checkbox",{name:/I have reviewed this immutable intent/});await expect(ack).toBeEnabled();await expect(ack).not.toBeChecked();
  await expect(page.getByRole("button",{name:"Dispatch this test operation",exact:true})).toBeDisabled();await ack.check();
  await page.getByRole("button",{name:"Dispatch this test operation",exact:true}).click();
  await expect(page.getByText("The provider outcome is unknown.",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"Dispatch this test operation",exact:true})).toHaveCount(0);expect(await calls("dispatch_intent")).toBe(1);
  checks.push("A separately acknowledged dispatch makes one request; unknown result removes the dispatch control and explains manual reconciliation");
  await page.getByRole("button",{name:"Reconcile with canonical record",exact:true}).click();await expect.poll(()=>calls("reconcile")).toBe(1);
  await page.getByRole("button",{name:"Reload saved dispute record",exact:true}).click();expect(await calls("dispatch_intent")).toBe(1);
  await expect(page.getByText("The provider outcome is unknown.",{exact:false})).toBeVisible();
  checks.push("Reconciliation and saved-record reload do not repeat an uncertain dispatch or report a bank victory");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  // A separate controlled case for amount input: do not make the fixture imply
  // that a new decision is permitted while the earlier operation is uncertain.
  await page.evaluate(()=>{(window as any).fixture.intents=[];(window as any).fixture.version++;});
  await page.getByRole("button",{name:"Reload saved dispute record",exact:true}).click();
  await expect(page.getByText("No operations prepared.",{exact:false})).toBeVisible();
  await page.getByRole("checkbox",{name:/I confirm that any supplied facts/}).check();
  await page.getByLabel("Proposed response to the provider dispute").selectOption("merchant-accepted");
  await page.getByLabel("Proposed refund amount in NGN").fill("100.01");await page.getByRole("button",{name:"Prepare merchant decision",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("cannot exceed the original payment");expect(await calls("prepare_decision")).toBe(0);
  await page.getByLabel("Proposed refund amount in NGN").fill("12.34");await page.getByRole("button",{name:"Prepare merchant decision",exact:true}).click();
  await expect.poll(()=>calls("prepare_decision")).toBe(1);
  expect(await page.evaluate(()=>(window as any).requests.find((r:any)=>r.body?.action==="prepare_decision").body.amountKobo)).toBe(1234);
  checks.push("NGN decision input converts to exact integer kobo and blocks an amount above the original payment before sending");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel("Reason for the next finance action").focus();await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe("BUTTON");
  checks.push("360px compiled-product-style reflow and native keyboard focus work for the finance review");
  await page.evaluate(()=>(window as any).forbidden=true);await transitions("non-finance","finance");
  await expect(page.getByRole("alert")).toContainText("Active finance permission and recent MFA required");
  await expect(page.getByRole("button",{name:"Prepare receipt from saved order"})).toHaveCount(0);
  checks.push("Controlled finance permission denial renders an error without finance data or action controls");
  expect(externalRequests).toEqual([]);report.status="passed_controlled_browser_not_merchant_or_authority_acceptance";
}catch(error){report.status="failed";report.failure=error instanceof Error?error.message.slice(0,1500):"BROWSER_CASE_FAILED";process.exitCode=1;}
finally{
  report.sourceHashes=await Promise.all(["artifacts/valo/src/components/payment-concerns.tsx","artifacts/valo/src/screens/finance-disputes.tsx",
    "artifacts/valo/src/screens/purchase-history.tsx","artifacts/valo/src/screens/finance-refunds.tsx","lib/api-client-react/src/custom-fetch.ts",
    "lib/api-client-react/src/generated/api.ts","lib/api-client-react/src/request-scope.ts"].map(async path=>({path,sha256:createHash("sha256").update(await readFile(resolve(root,path))).digest("hex")})));
  const out=resolve(root,"generated-artifacts/valo-completion");await mkdir(out,{recursive:true});
  await writeFile(resolve(out,"dispute-workflow-browser.json"),JSON.stringify(report,null,2)+"\n");
  await writeFile(resolve(out,`dispute-workflow-browser-${Date.now()}.json`),JSON.stringify(report,null,2)+"\n");
  await page.screenshot({path:resolve(out,"dispute-workflow-browser.jpg"),fullPage:true});
  await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  console.log(JSON.stringify(report,null,2));
}
