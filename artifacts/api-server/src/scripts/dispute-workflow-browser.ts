/// <reference lib="dom" />
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
import{PaymentConcerns,FinancePaymentConcerns}from"./src/components/payment-concerns";
import{FinanceDisputeCard,CustomerDisputeInformation,DisputeFormsBoundary}from"./src/components/dispute-workflows";
const orderId="11111111-1111-4111-8111-111111111111",disputeId="22222222-2222-4222-8222-222222222222";
const concernId="33333333-3333-4333-8333-333333333333",now="2026-11-15T12:00:00.000Z";
window.requests=[];window.fixtureActor="A";window.forbidden=false;window.delayMutation=false;window.delayed=[];window.nextAction=1;
window.fixture={executionEnabled:false,concerns:[],actions:[],information:[],history:[],held:false,controlVersion:1};
const detail=()=>({id:disputeId,providerId:"90001",orderReference:"CONTROLLED-ORDER-A",amountKobo:10000,status:"awaiting-merchant-feedback",resolution:null,
 held:window.fixture.held,controlVersion:window.fixture.controlVersion,category:"general",entitlementStatus:"suspended",actions:window.fixture.actions,
 information:window.fixture.information,history:window.fixture.history,executionEnabled:window.fixture.executionEnabled,policy:"Controlled test workflow. No merchant calls."});
const information=()=>({disputes:[{id:disputeId,status:"awaiting-merchant-feedback"}],information:window.fixtureActor==="B"?[]:window.fixture.information,notice:"Save exact facts with consent for this existing dispute; no automatic provider send."});
function event(action,reason,actorType="finance"){return{id:crypto.randomUUID(),action,reason,actorType,createdAt:now};}
window.fetch=async(input,options={})=>{
 const url=String(input),method=(options.method||"GET").toUpperCase(),body=options.body?JSON.parse(options.body):null;
 if(!url.startsWith("/api/"))throw Error("UNEXPECTED_OUTBOUND_REQUEST");
 window.requests.push({url,method,body,actor:window.fixtureActor});
 if(window.forbidden&&url.startsWith("/api/admin/"))return Response.json({error:"Active finance permission and recent MFA required."},{status:403});
 if(url==="/api/workspace/disputes"&&method==="GET")return Response.json({concerns:window.fixtureActor==="A"?window.fixture.concerns:[],notice:"Customer concerns are not bank disputes."});
 if(url===\`/api/workspace/orders/\${orderId}/concerns\`&&method==="POST"){
   const saved={id:concernId,orderId,orderReference:"CONTROLLED-ORDER-A",message:body.message,status:"open",latestReply:null,version:1,createdAt:now,updatedAt:now,history:[event("created",body.message,"customer")]};
   window.fixture.concerns=[saved];if(window.delayMutation)return new Promise(resolve=>window.delayed.push(()=>resolve(Response.json(saved))));return Response.json(saved);
 }
 if(url===\`/api/workspace/concerns/\${concernId}/respond\`&&method==="POST"){
   const row=window.fixture.concerns[0];row.version++;row.history.push(event("customer_reply",body.message,"customer"));return Response.json(row);
 }
 if(url===\`/api/workspace/orders/\${orderId}/dispute-information\`){
   if(method==="POST")window.fixture.information.push({id:"55555555-5555-4555-8555-555555555555",disputeId,consentVersion:body.consentVersion,createdAt:now,
     information:{customer_email:"controlled@example.invalid",customer_name:body.customerName,customer_phone:body.customerPhone,service_details:body.serviceDetails,
       ...(body.deliveryAddress?{delivery_address:body.deliveryAddress}:{}),...(body.deliveryDate?{delivery_date:body.deliveryDate}:{})}});
   return Response.json(information());
 }
 if(url==="/api/admin/payment-concerns"&&method==="GET")return Response.json({concerns:window.fixture.concerns,notice:"Latest saved concern history."});
 if(url===\`/api/admin/payment-concerns/\${concernId}/action\`&&method==="POST"){
   const row=window.fixture.concerns[0];row.version++;row.latestReply=body.message;row.status=body.action==="close"?"closed":body.action==="request_information"?"needs_information":"responded";
   row.history.push(event(body.action,body.message));return Response.json(row);
 }
 if(url===\`/api/admin/disputes/\${disputeId}\`&&method==="GET")return Response.json(detail());
 if(url===\`/api/admin/disputes/\${disputeId}/hold\`&&method==="POST"){
   window.fixture.held=body.held;window.fixture.controlVersion++;window.fixture.history.push(event(body.held?"held":"hold_released",body.reason));return Response.json(detail());
 }
 if(url===\`/api/admin/disputes/\${disputeId}/actions\`&&method==="POST"){
   const id="44444444-4444-4444-8444-"+String(window.nextAction++).padStart(12,"0");
   window.fixture.actions.push({id,kind:body.kind,status:"prepared",version:1,attempts:0,payload:{message:body.message,...(body.resolution?{resolution:body.resolution,amountKobo:body.amountKobo}:{})},result:null,failure:null});
   window.fixture.history.push({id:crypto.randomUUID(),actionId:id,status:"prepared",createdAt:now});return Response.json(detail());
 }
 const control=/^\\/api\\/admin\\/dispute-actions\\/([^/]+)\\/(execute|reconcile|cancel)$/.exec(url);
 if(control&&method==="POST"){
   const action=window.fixture.actions.find(row=>row.id===control[1]);
   if(control[2]==="execute"){action.status="unknown";action.attempts=1;action.failure="PROVIDER_OUTCOME_UNCERTAIN";}
   else if(control[2]==="cancel")action.status="cancelled";
   action.version++;window.fixture.history.push({id:crypto.randomUUID(),actionId:action.id,status:action.status,createdAt:now});return Response.json(detail());
 }
 throw Error("UNHANDLED_CONTROLLED_REQUEST: "+method+" "+url);
};
function Fixture(){const[state,setState]=useState({actor:"A",view:"customer",epoch:0});
 window.transition=(actor,view)=>{window.fixtureActor=actor;flushSync(()=>setState(s=>({actor,view,epoch:s.epoch+1})));};
 return <AccountStateBoundary identityKey={state.actor+"/controlled-"+state.epoch}><DisputeFormsBoundary><main style={{maxWidth:900,margin:"auto",padding:20}}>
 {state.view==="customer"?<PaymentConcerns orderId={orderId} orderReference="CONTROLLED-ORDER-A"/>:state.view==="information"?<CustomerDisputeInformation orderId={orderId}/>:
 <><FinancePaymentConcerns/><FinanceDisputeCard id={disputeId}/></>}</main></DisputeFormsBoundary></AccountStateBoundary>;
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
  compiledProductCssSha256:createHash("sha256").update(css).digest("hex"),actualComponents:["components/payment-concerns.tsx","components/dispute-workflows.tsx","components/account-state-boundary.tsx"],checks};
const transitions=async(actor:string,view:string)=>page.evaluate(({actor,view})=>(window as any).transition(actor,view),{actor,view});
const countRequests=async(suffix:string)=>page.evaluate(suffix=>(window as any).requests.filter((row:any)=>row.method==="POST"&&row.url.endsWith(suffix)).length,suffix);
try{
  await page.goto(`http://127.0.0.1:${address.port}`);
  await expect(page.getByText("No concerns saved for this order.")).toBeVisible();
  const concern=page.getByLabel("What happened with this order?");await concern.fill("CONTROLLED_CUSTOMER_A payment concern");
  await expect(page.getByRole("button",{name:"Save payment concern",exact:true})).toBeDisabled();
  await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Save payment concern",exact:true}).click();
  await expect(page.getByText("Concern saved. Your reference is",{exact:false})).toContainText("33333333-3333-4333-8333-333333333333");
  const firstBody=await page.evaluate(()=>(window as any).requests.find((row:any)=>row.url.endsWith("/concerns")&&row.method==="POST").body);
  expect(firstBody).toMatchObject({message:"CONTROLLED_CUSTOMER_A payment concern",acknowledgement:true});expect(firstBody.providerId).toBeUndefined();
  checks.push("Standalone customer concern requires acknowledgement, saves its reference, and sends no provider dispute identifier");
  await page.getByText("Replies and history",{exact:true}).click();await page.getByLabel("Add information to this concern").fill("CONTROLLED_ADDITIONAL_INFORMATION");
  await page.getByRole("button",{name:"Save reply",exact:true}).click();await expect(page.getByText("CONTROLLED_ADDITIONAL_INFORMATION",{exact:true})).toBeVisible();
  checks.push("Separate versioned customer reply persists in concern history");
  await concern.fill("UNSAVED_PRIVATE_CONCERN_A");await page.evaluate(()=>history.pushState({},"","/leave-concern"));
  await expect(page.getByRole("dialog")).toBeVisible();await page.getByRole("button",{name:"Keep editing",exact:true}).click();await expect(concern).toHaveValue("UNSAVED_PRIVATE_CONCERN_A");
  checks.push("Existing native unsaved-navigation boundary protects the added standalone concern form");
  await transitions("B","customer");await expect(concern).toHaveValue("");await expect(page.locator("body")).not.toContainText("CONTROLLED_CUSTOMER_A");await expect(page.getByRole("checkbox")).not.toBeChecked();
  checks.push("Account boundary clears concern history, unsaved text and acknowledgement on identity switch");
  await transitions("A","customer");await concern.fill("LATE_PRIVATE_CONCERN_A");await page.getByRole("checkbox").check();await page.evaluate(()=>(window as any).delayMutation=true);
  await page.getByRole("button",{name:"Save payment concern",exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).delayed.length)).toBe(1);
  await transitions("B","customer");await page.evaluate(()=>{(window as any).delayMutation=false;for(const resolve of (window as any).delayed)resolve();});
  await expect(concern).toHaveValue("");await expect(page.locator("body")).not.toContainText("Concern saved. Your reference is");
  checks.push("Late old-account concern response cannot populate the new account or show its saved reference");
  await transitions("A","information");await page.getByLabel("Selected existing bank dispute").selectOption("22222222-2222-4222-8222-222222222222");
  await page.getByLabel("Your actual name").fill("Controlled Customer");await page.getByLabel("Your actual phone number").fill("00000000000");
  await page.getByLabel("What was actually supplied or disputed").fill("CONTROLLED_SUPPLIED_FACTS");await expect(page.getByRole("button",{name:"Save statement — not a bank decision"})).toBeDisabled();
  await page.getByRole("checkbox",{name:/I consent to finance sharing/}).check();await page.getByRole("button",{name:"Save statement — not a bank decision"}).click();
  await expect(page.getByText("Statement saved for this existing dispute.",{exact:false})).toBeVisible();await page.getByText("Saved statements",{exact:true}).click();
  await expect(page.getByText("CONTROLLED_SUPPLIED_FACTS",{exact:true})).toBeVisible();await expect(page.locator("pre")).toHaveCount(0);
  const statement=await page.evaluate(()=>(window as any).requests.find((r:any)=>r.method==="POST"&&r.url.endsWith("/dispute-information")).body);
  expect(statement.consentVersion).toBe("test-dispute-information-v1");expect(statement.deliveryDate).toBeUndefined();expect(statement.deliveryAddress).toBeUndefined();expect(statement.customerEmail).toBeUndefined();
  checks.push("Native selected-bank-dispute consent flow remains separate, saves actual supplied facts, and invents no optional delivery data or email");
  await transitions("finance","finance");await page.getByLabel("Message visible to the customer").fill("CONTROLLED_FINANCE_RESPONSE saved in concern history");
  await page.getByRole("button",{name:"Save concern response",exact:true}).click();await page.getByText("Customer concern history",{exact:true}).click();
  await expect(page.getByText("CONTROLLED_FINANCE_RESPONSE saved in concern history",{exact:true})).toBeVisible();
  checks.push("Finance concern response is readable in saved history and does not call an email or provider route");
  await page.getByLabel("Accurate reason / provider message").fill("Verified controlled order receipt preparation");
  await page.getByRole("button",{name:"Prepare immutable intent only",exact:true}).click();await expect(page.getByText("Immutable intent saved. No provider operation has been sent.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Send authorised test action once",exact:true})).toBeDisabled();expect(await countRequests("/execute")).toBe(0);
  checks.push("Native immutable preparation remains usable while merchant execution is disabled, with no execute call");
  await page.evaluate(()=>(window as any).fixture.executionEnabled=true);await page.getByRole("button",{name:"Reload saved dispute record",exact:true}).click();
  const executeAck=page.getByRole("checkbox",{name:/I have reviewed this exact saved intent/});await expect(executeAck).toBeEnabled();await expect(executeAck).not.toBeChecked();
  await page.getByLabel("Reason for changing the finance hold").fill("Pause this controlled dispute for finance review");await page.getByRole("button",{name:"Place finance hold",exact:true}).click();
  await expect(page.getByText("Finance hold is active",{exact:false})).toBeVisible();await expect(executeAck).toBeDisabled();expect(await countRequests("/execute")).toBe(0);
  await page.getByLabel("Reason for changing the finance hold").fill("Release after controlled finance review completed");await page.getByRole("button",{name:"Release finance hold",exact:true}).click();
  await expect(executeAck).toBeEnabled();await expect(executeAck).not.toBeChecked();await expect(page.getByRole("button",{name:"Send authorised test action once",exact:true})).toBeDisabled();
  checks.push("Versioned finance hold prevents dispatch; release does not send and leaves per-intent acknowledgement unchecked");
  await executeAck.check();await page.getByRole("button",{name:"Send authorised test action once",exact:true}).click();await expect(page.getByText("The provider outcome is unknown.",{exact:false})).toBeVisible();
  expect(await countRequests("/execute")).toBe(1);expect(await page.evaluate(()=>(window as any).requests.find((r:any)=>r.url.endsWith("/execute")).body.acknowledgement)).toBe(true);
  await expect(page.getByRole("button",{name:"Send authorised test action once",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Fetch canonical state only",exact:true}).click();await expect.poll(()=>countRequests("/reconcile")).toBe(1);expect(await countRequests("/execute")).toBe(1);
  checks.push("Separate execute acknowledgement yields one native control call; unknown result has no resend and canonical reconciliation does not execute again");
  await page.evaluate(()=>{(window as any).fixture.actions=[];});await page.getByRole("button",{name:"Reload saved dispute record",exact:true}).click();await expect(page.getByText("No merchant operations prepared for this dispute.")).toBeVisible();
  await page.getByLabel("Operation",{exact:true}).selectOption("submit_evidence");await page.getByLabel("Exact saved customer statement").selectOption("55555555-5555-4555-8555-555555555555");
  await expect(page.locator("form").getByText("CONTROLLED_SUPPLIED_FACTS",{exact:true})).toBeVisible();await expect(page.locator("pre")).toHaveCount(0);await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByLabel("Operation",{exact:true}).selectOption("merchant_decision");await page.getByLabel("Merchant response",{exact:true}).selectOption("merchant-accepted");
  await page.getByLabel("Accurate reason / provider message").fill("Controlled partial acceptance amount review");await page.getByLabel("Amount to accept in NGN").fill("100.01");
  await page.getByRole("button",{name:"Prepare immutable intent only",exact:true}).click();await expect(page.getByRole("alert")).toContainText("cannot exceed the original payment");
  await page.getByLabel("Amount to accept in NGN").fill("12.34");await page.getByRole("button",{name:"Prepare immutable intent only",exact:true}).click();
  await expect.poll(()=>countRequests("/actions")).toBe(2);expect(await page.evaluate(()=>(window as any).requests.filter((r:any)=>r.url.endsWith("/actions")).at(-1).body.amountKobo)).toBe(1234);
  checks.push("Consented evidence is readable without raw JSON/private uploads; merchant NGN input blocks overpayment and sends exact integer kobo");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel("Reason for changing the finance hold").focus();await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe("BUTTON");
  checks.push("360px compiled-product reflow and native keyboard focus pass on the converged finance UI");
  await page.evaluate(()=>(window as any).forbidden=true);await transitions("non-finance","finance");
  await expect(page.getByText("Active finance permission and recent MFA required.",{exact:true}).first()).toBeVisible();await expect(page.getByRole("button",{name:"Prepare immutable intent only"})).toHaveCount(0);
  checks.push("Controlled finance permission denial hides native preparation data and controls");
  expect(externalRequests).toEqual([]);report.status="passed_converged_controlled_browser_not_merchant_or_authority_acceptance";
}catch(error){report.status="failed";report.failure=error instanceof Error?error.message.slice(0,1500):"BROWSER_CASE_FAILED";process.exitCode=1;}
finally{
  report.sourceHashes=await Promise.all(["artifacts/valo/src/components/payment-concerns.tsx","artifacts/valo/src/components/dispute-workflows.tsx",
    "artifacts/valo/src/screens/purchase-history.tsx","artifacts/valo/src/screens/finance-refunds.tsx","lib/api-client-react/src/custom-fetch.ts",
    "lib/api-client-react/src/generated/api.ts","lib/api-client-react/src/request-scope.ts"].map(async path=>({path,sha256:createHash("sha256").update(await readFile(resolve(root,path))).digest("hex")})));
  const out=resolve(root,"generated-artifacts/valo-completion");await mkdir(out,{recursive:true});
  await writeFile(resolve(out,"dispute-workflow-browser.json"),JSON.stringify(report,null,2)+"\n");
  await writeFile(resolve(out,`dispute-workflow-browser-${Date.now()}.json`),JSON.stringify(report,null,2)+"\n");
  await page.screenshot({path:resolve(out,"dispute-workflow-browser.jpg"),fullPage:true});
  await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  console.log(JSON.stringify(report,null,2));
}
