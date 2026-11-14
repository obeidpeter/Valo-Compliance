import { randomUUID,createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium,expect,type Page,type Browser } from "@playwright/test";
import { clerkSetup,setupClerkTestingToken } from "@clerk/testing/playwright";
import {mkdir as ensureReminderDirectory} from "node:fs/promises";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { GetCustomerAccountResponse,GetDocumentResponse,DownloadWorkspaceDataResponse } from "@workspace/api-zod";
import { syntheticDocument } from "../lib/valo-test-fixtures";
const checks:{name:string;status:string;diagnostic?:string}[]=[];
const run=randomUUID(),email=`valo-ux-${run}+clerk_test@example.com`;
let browser:Browser|undefined,page:Page|undefined,userId:string|undefined,workspaceId:string|undefined;
let unknownAck:string|undefined,phase="guard";
const ownIntakeIds:string[]=[];
async function check(name:string,fn:()=>Promise<void>){
  if(process.env.VALO_CUSTOMER_JOURNEY_SELECTION==="reminder"&&
    !["managed_verified_customer_can_open_private_routes","real_manual_reminder_records_past_due_dates_and_mobile_keyboard_flow"].includes(name))return;
  phase=name;try{await fn();checks.push({name,status:"pass"});}
  catch{
    const safe=await page?.evaluate(`({path:location.pathname,headings:document.querySelectorAll("main h1").length,
      width:innerWidth,scroll:document.documentElement.scrollWidth,focus:document.activeElement?.tagName,
      focusOutline:document.activeElement?getComputedStyle(document.activeElement).outline:null,
      focusId:document.activeElement?.id,focusVisible:document.activeElement?.matches(":focus-visible"),
      overflow:Array.from(document.querySelectorAll("main *")).filter(e=>e.getBoundingClientRect().right>innerWidth+1)
        .slice(0,5).map(e=>({tag:e.tagName,class:String(e.className)}))})`).catch(()=>null);
    checks.push({name,status:"fail",diagnostic:JSON.stringify(safe??"Unavailable; raw form details suppressed")});process.exitCode=1;
  }
}
async function api(path:string,method="GET",body?:unknown){
  return page!.evaluate(async({path,method,body})=>{
    const r=await fetch(path,{method,headers:body===undefined?{}:{"Content-Type":"application/json"},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return{status:r.status,cache:r.headers.get("cache-control"),body:await r.json()};
  },{path,method,body});
}
async function reflow(){expect(await page!.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);}
try{
  if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT||
    process.env.VALO_RUN_CUSTOMER_JOURNEY!=="synthetic-development-only"||
    !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")||!process.env.REPLIT_DEV_DOMAIN)
    throw Error("SYNTHETIC_DEVELOPMENT_INSTANCE_REQUIRED");
  await clerkSetup({dotenv:false,debug:false});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||"/repl/tools/bin/chromium",
    headless:true,args:["--no-sandbox"]});
  const context=await browser.newContext({baseURL:`https://${process.env.REPLIT_DEV_DOMAIN}`,viewport:{width:1280,height:900}});
  await setupClerkTestingToken({context});page=await context.newPage();page.setDefaultTimeout(20000);
  await check("desktop_exact_hero_and_public_about_contact_routes",async()=>{
    await page!.goto("/");await expect(page!.getByTestId("text-headline")).toHaveText("The documents you need. The business rules you should know.");
    for(const path of["/about","/contact","/account-access","/help","/library","/resources","/industries"]){
      await page!.goto(path);await expect(page!.locator("main h1")).toHaveCount(1);await reflow();
    }
  });
  await check("catalogue_pagination_first_full_final_empty_and_keyboard_filter_fixtures",async()=>{
    let total=45;
    await page!.route("**/api/public/catalogue*",r=>{
      const p=Number(new URL(r.request().url()).searchParams.get("page")??1);
      return r.fulfill({json:{page:p,total,heldTemplates:40,items:Array.from({length:Math.max(0,Math.min(20,total-(p-1)*20))},(_,i)=>({
        id:`fixture-${(p-1)*20+i}`,slug:`fixture-${(p-1)*20+i}`,title:`Pagination fixture ${(p-1)*20+i}`,
        type:"template",industry:"All industries",summary:"Browser-only pagination fixture; not a release."}))}});
    });
    await page!.goto("/library");
    await expect(page!.getByTestId("button-prev")).toBeDisabled();
    await expect(page!.getByTestId("button-next")).toBeEnabled();
    await page!.getByTestId("button-next").click();
    await expect(page!).toHaveURL(/page=2/);await expect(page!.getByTestId("button-next")).toBeEnabled();
    await page!.getByTestId("button-next").click();
    await expect(page!).toHaveURL(/page=3/);await expect(page!.getByTestId("button-next")).toBeDisabled();
    await page!.getByTestId("button-prev").click();await expect(page!).toHaveURL(/page=2/);
    await page!.goto("/library?page=4");
    await expect(page!.getByRole("link",{name:/Pagination fixture/})).toHaveCount(0);
    const next=page!.getByTestId("button-next");if(await next.count())await expect(next).toBeDisabled();
    total=0;await page!.goto("/library");
    await expect(page!.getByRole("link",{name:/Pagination fixture/})).toHaveCount(0);
    const filters=page!.getByRole("group",{name:"Content type filters"});
    await expect(filters.getByRole("tab")).toHaveCount(0);
    await page!.getByTestId("tab-type-guidance").focus();await page!.keyboard.press("Space");
    await expect(page!.getByTestId("tab-type-guidance")).toHaveAttribute("aria-pressed","true");
    await expect(page!).toHaveURL(/type=guidance/);
    await page!.unroute("**/api/public/catalogue*");
  });
  await check("real_mobile_menu_keyboard_focus_and360px_public_routes",async()=>{
    await page!.setViewportSize({width:360,height:800});
    for(const path of["/","/about","/contact","/account-access","/help","/library","/resources","/industries"]){
      await page!.goto(path);await expect(page!.locator("main h1")).toHaveCount(1);await reflow();
      await page!.keyboard.press("Tab");
      expect(await page!.evaluate("document.activeElement!==document.body")).toBe(true);
      await expect(page!.locator(":focus")).toBeVisible();
    }
    await page!.goto("/industries");
    const menu=page!.getByTestId("button-menu");
    await menu.focus();await page!.keyboard.press("Enter");await expect(menu).toHaveAttribute("aria-expanded","true");
    await page!.keyboard.press("Tab");await page!.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded","false");await expect(menu).toBeFocused();
    const first=page!.locator('main a[href^="/industries/"]').first();await expect(first).toBeVisible();await first.click();
    await expect(page!.locator("main h1")).toHaveCount(1);await reflow();
  });
  await check("real_anonymous_account_access_form_keyboard_submit_and_durable_ack",async()=>{
    await page!.goto("/account-access");
    await page!.getByTestId("input-access-email").fill(`unknown-${run}@example.invalid`);
    await page!.getByTestId("input-access-message").fill("Synthetic unable-to-sign-in request; no passwords or confidential records.");
    await page!.getByTestId("button-access-submit").focus();
    const response=page!.waitForResponse(r=>r.url().endsWith("/api/public/access-support")&&r.request().method()==="POST");
    await page!.keyboard.press("Enter");const r=await response;expect(r.status()).toBe(201);
    const ack=await r.json();unknownAck=ack.message;
    const id=ack.reference.replace("VALO-ACCESS-","");ownIntakeIds.push(id);
    await expect(page!.getByTestId("access-support-ack")).toBeVisible();await reflow();
    expect(ack.delivery).toBe("not_dispatched");
    expect((await pool.query("SELECT status FROM valo_access_support WHERE id=$1",[id])).rows[0].status).toBe("awaiting_staff");
    const controls=await page!.locator('main input:not([type="hidden"]),main textarea').evaluateAll(els=>
      els.filter(e=>e.getAttribute("type")!=="radio"&&e.getAttribute("tabindex")!=="-1")
        .every(e=>Boolean((e as unknown as {labels?:ArrayLike<unknown>}).labels?.length||e.getAttribute("aria-label"))));
    expect(controls).toBe(true);
  });
  await check("released_resource_UI_fixture_links_plain_text_and_withdrawal_are_not_publication",async()=>{
    // Browser-only response fixtures: never inserted or published in the running database.
    const resource={id:randomUUID(),slug:"synthetic-ui-resource",title:"Synthetic UI-only resource",kind:"guide",industrySlugs:[],
      summary:"UI-only response fixture, not released regulatory guidance.",body:"UI-only fixture.\n\n<script>window.fixtureExecuted=true</script>",
      reviewedAt:new Date().toISOString(),disclosure:"Synthetic browser fixture only; no publication or review claimed.",
      scope:"UI wiring only",limitations:"Not real Nigerian guidance",sources:[{url:"https://example.invalid/source",title:"Fixture reference",locator:"Fixture"}]};
    let available=true;
    await page!.route("**/api/public/resources",r=>r.fulfill({json:available?[resource]:[]}));
    await page!.route("**/api/public/resources/synthetic-ui-resource",r=>r.fulfill({status:available?200:404,
      json:available?resource:{error:"Unavailable"}}));
    await page!.goto("/resources");
    await page!.getByRole("link",{name:/Synthetic UI-only resource/}).first().click();
    await expect(page!.locator("main h1")).toHaveText(resource.title);
    expect(await page!.evaluate("window.fixtureExecuted")).toBeUndefined();
    await expect(page!.getByText(resource.body.split("\n\n")[1],{exact:true})).toBeVisible();
    await reflow();available=false;await page!.reload();
    await expect(page!.locator("main")).toContainText(/unavailable|no longer|withdrawn/i);
    await page!.unroute("**/api/public/resources");await page!.unroute("**/api/public/resources/synthetic-ui-resource");
  });
  await check("template_library_detail_preview_UI_fixture_keeps_real_account_and_release_gates",async()=>{
    const id=randomUUID(),slug="synthetic-ui-template";
    const row={id,slug,title:"Synthetic UI-only form",type:"template",industry:"All industries",summary:"UI fixture, not a released document."};
    await page!.route("**/api/public/catalogue*",r=>r.fulfill({json:{items:[row],total:1,page:1,heldTemplates:40}}));
    await page!.route(`**/api/public/templates/${slug}`,r=>r.fulfill({json:{...row,templateId:"TPL-07",version:1,
      reviewedAt:new Date().toISOString(),reviewBy:new Date(Date.now()+86400000).toISOString(),
      disclosure:"Synthetic UI fixture, not an actual reviewed or published form.",scope:"UI-only wiring",
      limitations:"No actual content eligibility or export demonstrated",preview:["SAMPLE FIELD: Business name [your information]"],
      developmentOnly:true,commercialLicenceAccepted:false,formats:["docx","pdf"]}}));
    await page!.goto("/library");await page!.getByRole("link",{name:/Synthetic UI-only form/}).click();
    await expect(page!.getByTestId("section-preview")).toContainText("SAMPLE FIELD");
    await expect(page!.getByTestId("link-sign-in")).toBeVisible();
    await expect(page!.getByTestId("button-download-pdf")).toHaveCount(0);
    expect((await api(`/api/workspace/templates/${id}/files/pdf`)).status).toBe(401);
    await page!.unroute("**/api/public/catalogue*");await page!.unroute(`**/api/public/templates/${slug}`);
  });
  await check("managed_verified_customer_can_open_private_routes",async()=>{
    await page!.setViewportSize({width:1280,height:900});await page!.goto("/sign-up");
    await page!.locator(".cl-signUp-root").waitFor();
    for(const[name,value]of[["firstName","Synthetic"],["lastName","Experience"]]as const){
      const field=page!.locator(`input[name="${name}"]`);if(await field.isVisible())await field.fill(value);
    }
    await page!.locator('input[name="emailAddress"]').fill(email);
    const password=page!.locator('input[name="password"]');if(await password.isVisible())await password.fill(`Synthetic-${randomUUID()}!9`);
    const legal=page!.locator('input[name="legalAccepted"]');if(await legal.isVisible())await legal.check();
    await page!.getByRole("button",{name:"Continue",exact:true}).click();
    await page!.getByRole("textbox",{name:"Enter verification code"}).pressSequentially("424242");
    await page!.waitForFunction("Boolean(window.Clerk?.user)",{},{timeout:30000});
    userId=await page!.evaluate<string>("window.Clerk.user.id");
    const account=await api("/api/workspace/account");expect(account.status).toBe(200);
    workspaceId=GetCustomerAccountResponse.parse(account.body).workspaceId;
    for(const path of["/workspace/checker","/workspace/assessments","/workspace/tasks","/workspace/notifications",
      "/workspace/purchases","/workspace/account","/workspace/privacy"]){
      await page!.goto(path);await expect(page!.locator("main h1").first()).toBeVisible();
      await expect(page!.locator("main")).not.toContainText("Something went wrong");
    }
  });
  await check("real_private_privacy_request_reload_and_JSON_download",async()=>{
    expect(userId).toBeTruthy();await page!.goto("/workspace/privacy");
    const created=await api("/api/workspace/documents","POST",syntheticDocument);expect(created.status).toBe(201);
    const createdDocument=GetDocumentResponse.parse(created.body);
    await page!.getByTestId("radio-privacy-deletion").check();
    await page!.getByTestId("input-privacy-message").fill("Synthetic request only. Verify all systems before any deletion.");
    await page!.getByTestId("checkbox-privacy-ack").check();
    await page!.getByTestId("button-privacy-submit").click();
    await expect(page!.getByTestId("privacy-ack")).toBeVisible();await page!.reload();
    expect(GetCustomerAccountResponse.parse((await api("/api/workspace/account")).body).privacyRequests.length).toBe(1);
    const download=page!.waitForEvent("download");await page!.getByTestId("button-download-workspace").click();
    const file=await download;expect(file.suggestedFilename()).toMatch(/valo-workspace.*json/);
    const raw=await api("/api/workspace/data-export");expect(raw.status).toBe(200);expect(raw.cache).toContain("no-store");
    const exported=DownloadWorkspaceDataResponse.parse(raw.body);
    expect(exported.workspaceId).toBe(workspaceId);
    expect((exported.data.documentRevisions as {documentId:string}[]).some(r=>r.documentId===createdDocument.id)).toBe(true);
    await page!.goto("/workspace/purchases");await expect(page!.getByTestId("text-purchases-message")).toContainText(/not enabled/);
    await page!.goto("/staff");expect((await api("/api/admin/operations?area=support")).status).toBe(403);
  });
  await check("real_manual_reminder_records_past_due_dates_and_mobile_keyboard_flow",async()=>{
    await page!.goto("/workspace/ai");
    const reminderRadio=page!.getByTestId("radio-task-payment_reminder");
    await reminderRadio.focus();await reminderRadio.press("Space");await expect(reminderRadio).toBeChecked();
    for(const[key,value]of Object.entries({issuerName:"Fictional Business A",recipientName:"Fictional Customer B",
      documentNumber:"DEMO-REM-003",issueDate:"2026-11-13",dueDate:"2026-11-05"}))
      await page!.locator(`input[id$="${key}"]`).fill(value);
    await page!.getByTestId("input-ai-recorded-balance").check();
    await page!.getByTestId("input-ai-invoice-amount").fill("20000.00");
    for(const[i,reference,amount]of [[0,"DEMO-P3A","5000.00"],[1,"DEMO-P3B","2500.00"]]as const){
      await page!.getByTestId("button-ai-add-payment").click();
      await page!.getByTestId(`input-ai-payment-reference-${i}`).fill(reference);
      await page!.getByTestId(`input-ai-payment-amount-${i}`).fill(amount);
      await expect(page!.getByTestId(`input-ai-payment-reference-${i}`)).toHaveAccessibleName(`Payment reference ${i+1}`);
    }
    await expect(page!.getByTestId("text-ai-summary")).toContainText("₦12,500.00");
    await page!.getByTestId("input-ai-payment-reference-1").fill(" demo-p3a ");
    await expect(page!.getByRole("alert").filter({hasText:"references must be distinct"})).toBeVisible();
    await page!.getByTestId("input-ai-payment-reference-1").fill("DEMO-P3B");
    await page!.getByTestId("input-ai-payment-amount-1").fill("20000.00");
    await expect(page!.getByRole("status").filter({hasText:"no positive amount due"})).toBeVisible();
    await page!.getByTestId("input-ai-payment-amount-1").fill("2500.00");
    for(const width of [360,390,768,1280]){
      await page!.setViewportSize({width,height:874});await reflow();
      await page!.getByTestId("input-ai-payment-reference-0").focus();await page!.keyboard.press("Tab");
      await expect(page!.getByTestId("input-ai-payment-amount-0")).toBeFocused();
      await expect(page!.getByTestId("input-ai-payment-amount-0")).toHaveCSS("outline-style","solid");
      await expect(page!.getByTestId("input-ai-payment-amount-0")).toHaveCSS("outline-width","2px");
    }
    await page!.setViewportSize({width:390,height:874});await reflow();
    await ensureReminderDirectory(fileURLToPath(new URL("../../../../generated-artifacts/valo-customer-ux/",import.meta.url)),{recursive:true});
    await page!.getByTestId("input-ai-invoice-amount").scrollIntoViewIfNeeded();
    await page!.screenshot({path:fileURLToPath(new URL("../../../../generated-artifacts/valo-customer-ux/reminder-mobile.jpg",import.meta.url))});
    // No AI consent or provider call: the independent manual editor must remain useful.
    const request=page!.waitForResponse(r=>r.url().endsWith("/api/workspace/documents")&&r.request().method()==="POST");
    await page!.getByTestId("button-manual-draft").click();const response=await request;
    expect(response.status()).toBe(201);const document=GetDocumentResponse.parse(await response.json());
    expect(document.content.financialInput?.amountDueKobo).toBe("1250000");
    expect(document.content.financialInput?.paymentRecord?.payments.map(p=>p.reference)).toEqual(["DEMO-P3A","DEMO-P3B"]);
    await page!.waitForURL(`**/workspace/documents/${document.id}`);await page!.reload();
    const reopened=GetDocumentResponse.parse((await api(`/api/workspace/documents/${document.id}`)).body);
    expect(reopened.content.fields.dueDate).toBe("2026-11-05");expect(reopened.content.financialInput).toEqual(document.content.financialInput);
  });
  await check("multiple_activity_labels_and_editor_keyboard_relationships_across_mobile_sizes",async()=>{
    await page!.goto("/workspace/profile");
    await expect(page!.getByTestId("button-add-activity")).toBeVisible();
    while(await page!.locator('input[id^="activity-"]').count()<3)await page!.getByTestId("button-add-activity").click();
    for(let i=0;i<3;i++)await expect(page!.getByTestId(`input-activity-${i}`)).toHaveAccessibleName(new RegExp(`Business activity ${i+1}`));
    for(const width of [320,390,768]){await page!.setViewportSize({width,height:850});await reflow();}
    await page!.setViewportSize({width:1280,height:900});
    const input=structuredClone(syntheticDocument);
    input.title="Synthetic accessible mobile editor";
    input.content.fields.issuerName="Very long synthetic organisation ".repeat(4);
    input.content.blocks.push({id:"mobile-table",type:"table",text:"",rows:Array.from({length:12},(_,i)=>[`Row ${i+1}`,"LongUnbrokenSyntheticBusinessReference".repeat(5),"₦12,345.67"])});
    const created=await api("/api/workspace/documents","POST",input);expect(created.status).toBe(201);
    const doc=GetDocumentResponse.parse(created.body);
    await page!.goto(`/workspace/documents/${doc.id}`);
    const title=page!.getByTestId("input-title");
    for(const width of [320,360,390,768]){
      await page!.setViewportSize({width,height:850});await reflow();
      await title.focus();await page!.keyboard.press("Tab");await page!.keyboard.press("Shift+Tab");
      await expect(title).toBeFocused();
      expect(await title.evaluate(e=>{const s=e.ownerDocument.defaultView!.getComputedStyle(e);
        return s.outlineStyle!=="none"&&parseFloat(s.outlineWidth)>=2;})).toBe(true);
      const edit=page!.getByRole("tab",{name:"Edit",exact:true}),preview=page!.getByRole("tab",{name:"Saved preview"});
      await edit.focus();await page!.keyboard.press("ArrowRight");await expect(preview).toBeFocused();
      await expect(preview).toHaveAttribute("aria-selected","true");await reflow();
      await expect(page!.locator("#editor-preview-panel")).toBeVisible();
      await expect(page!.locator("#editor-edit-panel")).toBeHidden();
      if(width<768){
        const table=page!.getByTestId("preview-doc").getByRole("region").last();
        await table.focus();await page!.keyboard.press("ArrowRight");
        await expect.poll(()=>table.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
        await reflow();await preview.focus();
      }
      await page!.keyboard.press("Home");await expect(edit).toBeFocused();await reflow();
      await expect(edit).toHaveAttribute("aria-controls","editor-edit-panel");
      await expect(page!.locator("#editor-edit-panel")).toHaveAttribute("aria-labelledby","editor-tab-edit");
      await page!.keyboard.press("End");await expect(preview).toBeFocused();
      await page!.keyboard.press("ArrowLeft");await expect(edit).toBeFocused();
    }
    await page!.setViewportSize({width:1280,height:900});
  });
  await check("private_account_and_notification_mobile_reflow",async()=>{
    expect(userId).toBeTruthy();await page!.setViewportSize({width:360,height:800});
    for(const path of["/workspace/privacy","/workspace/notifications","/workspace/purchases","/workspace/account"]){
      await page!.goto(path);await expect(page!.locator("main h1").first()).toBeVisible();await reflow();
      await page!.keyboard.press("Tab");await expect(page!.locator(":focus")).toBeVisible();
    }
  });
  await check("actual_suspended_account_still_has_public_non_enumerating_support",async()=>{
    expect(userId).toBeTruthy();await clerkClient.users.banUser(userId!);
    await page!.goto("/account-access");
    await page!.getByTestId("input-access-email").fill(email);
    await page!.getByTestId("input-access-message").fill("Synthetic suspended account cannot sign in. Please review access without sharing account details.");
    const response=page!.waitForResponse(r=>r.url().endsWith("/api/public/access-support")&&r.request().method()==="POST");
    await page!.getByTestId("button-access-submit").click();
    const r=await response;expect(r.status()).toBe(201);const ack=await r.json();
    ownIntakeIds.push(ack.reference.replace("VALO-ACCESS-",""));
    expect(ack.message).toBe(unknownAck);expect(ack.delivery).toBe("not_dispatched");
    expect((await api("/api/workspace/account")).status).toBeGreaterThanOrEqual(401);
  });
}catch{checks.push({name:phase,status:"fail",diagnostic:"Journey setup failed; sensitive details suppressed."});process.exitCode=1;}
finally{
  let cleanupErrors=0;
  if(userId)await clerkClient.users.deleteUser(userId).catch(()=>{process.exitCode=1;cleanupErrors++;});
  await browser?.close();
  for(const id of ownIntakeIds)await pool.query("DELETE FROM valo_access_support WHERE id=$1",[id]).catch(()=>{cleanupErrors++;process.exitCode=1;});
  if(workspaceId){
    for(const table of["valo_support_tickets","valo_reminder_outbox","valo_reminder_preferences","valo_tasks","valo_assessments",
      "valo_ai_drafts","valo_document_revisions","valo_documents","valo_profile_versions","valo_events","valo_memberships","valo_workspaces"]){
      await pool.query(`DELETE FROM ${table} WHERE ${table==="valo_workspaces"?"id":"workspace_id"}=$1`,[workspaceId])
        .catch(()=>{cleanupErrors++;process.exitCode=1;});
    }
  }
  await pool.end();
  await writeFile(fileURLToPath(new URL("../../../../generated-artifacts/valo-customer-ux/browser.json",import.meta.url)),JSON.stringify({
    checkedAt:new Date().toISOString(),syntheticDevelopmentOnly:true,checks,
    selection:process.env.VALO_CUSTOMER_JOURNEY_SELECTION==="reminder"?"managed-identity-reminder-only":"full-existing-journey",
    actualManagedIdentityUsed:Boolean(userId),realEmailDeliveryClaimed:false,actualNewPublications:0,
    fixtureDisclosure:process.env.VALO_CUSTOMER_JOURNEY_SELECTION==="reminder"?
      "No intercepted content fixture groups were executed in this managed-identity/reminder subset.":
      "Resource and template fixtures were intercepted only in this browser, never inserted/published; no content eligibility or real published-master download proven.",
    r1Accepted:false,r2Accepted:false,cleanupErrors,
    cleanup:cleanupErrors?"Synthetic cleanup needs attention":"Owned synthetic identity and application rows removed; provider usage history untouched.",
  },null,2)+"\n");
}
