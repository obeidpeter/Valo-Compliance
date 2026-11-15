import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {mkdir,writeFile,access} from "node:fs/promises";
import {join} from "node:path";
import {eq,sql} from "drizzle-orm";
import {db,pool,valoPrices,valoOrders,valoRefundRequests,valoRefundTransitions,valoPaymentDisputes,
  valoDisputeInformation,valoDisputeActions,valoPaymentEvents,valoAccessSupport,valoStaffAssignments,
  valoPrivacyCases,valoPrivacyMessages,valoWorkspaceExports,valoWorkspaceExportAttempts,valoAIDrafts,
  valoDocumentRevisions,valoEvents} from "@workspace/db";
import {resolveWorkspace,saveProfile,createDocument} from "./valo-store";
import {syntheticProfile,syntheticDocument} from "./valo-test-fixtures";
import {createPrivacyCase,confirmPrivacyCase,simpleStaffPrivacyAction,readPrivacyCase,privacyChange} from "./valo-privacy";
import {processPrivacyErasure,replayErasureObjects,closePrivacyErasureLocks} from "./valo-privacy-erasure";
import {financeHeldFixture} from "./valo-finance-test-fixture";
import {workspaceDataExport} from "./valo-customer-access";
import {workspaceExportScratch} from "./valo-workspace-export-jobs";
import {removedPrivateText} from "./valo-privacy-redactions";
test("new synthetic private-copy inventory: scoped export, physical redaction, signed proof and crash scratch replay",{
  skip:process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only",timeout:60000,
},async t=>{
  const run=randomUUID(),marker="COPY_PRIVATE_"+run,reason="Synthetic copy inventory verification";
  const a=await resolveWorkspace("synthetic-copy-"+run),b=await resolveWorkspace("synthetic-copy-other-"+run);
  const staff={identityId:"synthetic-copy-privacy-"+run,recentMfa:true,verifiedAt:Date.now()};
  const held=await financeHeldFixture(),price=randomUUID(),order=randomUUID(),otherOrder=randomUUID(),
    refund=randomUUID(),dispute=randomUUID(),information=randomUUID(),action=randomUUID();
  const job=randomUUID(),attempt=randomUUID(),attempt2=randomUUID(),key=`valo/development/${a.workspaceId}/${randomUUID()}.json`;
  let caseId="",version=0;
  const budget=async()=>{
    const names=await db.execute<{table_name:string}>(sql`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND (table_name LIKE 'valo_ai_%' OR table_name LIKE 'valo_inference_%')
      AND table_name<>'valo_ai_drafts' ORDER BY table_name`);
    const checks:unknown[]=[];
    for(const{table_name}of names.rows){
      if(!/^valo_(ai|inference)_[a-z_]+$/.test(table_name))throw Error("UNEXPECTED_LEDGER_NAME");
      // Only aggregate fingerprints leave PostgreSQL; no existing prompts,
      // payloads, account identifiers or usage receipts enter test logs.
      checks.push([table_name,(await db.execute(sql`SELECT count(*)::text AS count,
        md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS fingerprint
        FROM ${sql.identifier(table_name)} t`)).rows]);
    }
    return JSON.stringify(checks);
  };
  const usageBefore=await budget();
  try{
    await db.insert(valoStaffAssignments).values({id:randomUUID(),identityId:staff.identityId,role:"privacy",grantedBy:"synthetic-test",reason});
    await saveProfile(a,{expectedRevision:0,profile:{...syntheticProfile,businessName:marker}});
    await createDocument(a,syntheticDocument);await createDocument(b,syntheticDocument);
    const[revision]=await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.workspaceId,a.workspaceId));
    await db.insert(valoAIDrafts).values({id:randomUUID(),workspaceId:a.workspaceId,actorId:a.identityId,idempotencyKey:randomUUID(),
      inputHash:"a".repeat(64),task:"invoice",status:"accepted",preview:{text:marker},plan:{text:marker},
      acceptedDocumentId:revision.documentId,promptVersion:"synthetic-no-provider",providerCalls:0});
    const line={title:"CONTROLLED FIXTURE ONLY",contentVersionId:held.id,licenceVersion:"controlled-not-approved",
      licenceText:"No commercial approval",taxTreatment:"No tax assertion"};
    await db.insert(valoPrices).values({id:price,contentVersionId:held.id,title:line.title,amountKobo:100,currency:"NGN",
      licenceVersion:line.licenceVersion,licenceText:line.licenceText,taxTreatment:line.taxTreatment,
      approvalReference:"SYNTHETIC-NOT-SALES",effectiveFrom:new Date()});
    for(const[actor,id]of[[a,order],[b,otherOrder]]as const)await db.insert(valoOrders).values({id,workspaceId:actor.workspaceId,
      requestedBy:actor.identityId,reference:"synthetic-charge-"+id,requestKey:randomUUID(),priceId:price,line,amountKobo:100,
      status:"verified_success",checkoutUrl:"https://example.invalid/"+marker});
    await db.insert(valoRefundRequests).values({id:refund,workspaceId:a.workspaceId,orderId:order,reason:marker,
      decisionReason:marker,reference:"synthetic-refund-"+refund,providerId:"synthetic-provider-refund-"+refund,
      status:"needs_review",amountKobo:50});
    await db.insert(valoRefundTransitions).values({id:randomUUID(),workspaceId:a.workspaceId,orderId:order,
      refundId:refund,actorId:staff.identityId,action:"synthetic_only",reason:marker});
    await db.insert(valoPaymentDisputes).values({id:dispute,workspaceId:a.workspaceId,orderId:order,
      providerId:"synthetic-dispute-"+dispute,status:"pending",amountKobo:100});
    await db.insert(valoDisputeInformation).values({id:information,workspaceId:a.workspaceId,orderId:order,disputeId:dispute,
      actorId:a.identityId,requestKey:randomUUID(),information:{statement:marker},consentVersion:"synthetic"});
    await db.insert(valoDisputeActions).values({id:action,workspaceId:a.workspaceId,orderId:order,disputeId:dispute,
      requestKey:randomUUID(),kind:"submit_evidence",informationId:information,payload:{statement:marker,amountKobo:50},
      sourceHash:"a".repeat(64),policyVersion:"synthetic-no-provider",authorisedBy:staff.identityId});
    for(const ref of["synthetic-charge-"+order,"synthetic-refund-"+refund,"synthetic-provider-refund-"+refund,
      "synthetic-dispute-"+dispute,"synthetic-charge-"+otherOrder])
      await db.insert(valoPaymentEvents).values({id:randomUUID(),eventKey:run+ref,bodyHash:"b".repeat(64),
        eventType:"synthetic.no_dispatch",reference:ref,status:"processed",failure:marker});
    const prepared=await createPrivacyCase(a,"same-synthetic@example.invalid",{kind:"export",idempotencyKey:randomUUID(),
      message:marker,acknowledgement:true});
    await db.transaction(async tx=>{
      const row=await readPrivacyCase(tx,prepared.reference.slice(5));
      await privacyChange(tx,row,{identityId:staff.identityId,type:"staff"},"synthetic_snapshot",marker,
        {resultJson:{data:{nestedFullSnapshot:marker}},steps:row.steps.map(s=>({...s,detail:marker}))});
    });
    await db.insert(valoPrivacyMessages).values({id:randomUUID(),workspaceId:a.workspaceId,caseId:prepared.reference.slice(5),
      replyToVersion:1,body:marker});
    const publicIntake=randomUUID();
    await db.insert(valoAccessSupport).values({id:publicIntake,idempotencyKey:randomUUID(),payloadHash:"f".repeat(64),
      contactEmail:"same-synthetic@example.invalid",topic:"account_access",message:marker,noticeVersion:"synthetic"});
    const request=await createPrivacyCase(a,"same-synthetic@example.invalid",{kind:"deletion",idempotencyKey:randomUUID(),
      message:marker,acknowledgement:true});
    caseId=request.reference.slice(5);let detail=await confirmPrivacyCase(a,caseId,{expectedVersion:1,acknowledgement:true});
    detail=await simpleStaffPrivacyAction(staff,caseId,{expectedVersion:detail.request.version,action:"claim",reason});
    version=detail.request.version;
    await db.insert(valoWorkspaceExports).values({id:job,workspaceId:a.workspaceId,requesterId:a.identityId,requestKey:randomUUID(),
      status:"preparing",currentAttemptId:attempt,leaseUntil:new Date(Date.now()+3600000),expiresAt:new Date(Date.now()+3600000)});
    for(const[id,status]of[[attempt,"uploading"],[attempt2,"ready"]]as const)
      await db.insert(valoWorkspaceExportAttempts).values({id,workspaceId:a.workspaceId,jobId:job,objectKey:id===attempt?key:
        `valo/development/${a.workspaceId}/${randomUUID()}.json`,status});
    await mkdir(workspaceExportScratch(attempt),{recursive:true});await writeFile(join(workspaceExportScratch(attempt),"workspace.json"),marker);
    const removed:string[]=[];
    const act=async(action:"start_erasure"|"resume_erasure")=>{
      detail=await processPrivacyErasure({...staff,verifiedAt:Date.now()},caseId,
        {expectedVersion:version,action,reason:marker,acknowledgement:true},async key=>{removed.push(key);});
      version=detail.request.version;
    };
    await t.test("export includes owned charge/refund/dispute events, not another tenant or unlinked email intake or nested snapshots",async()=>{
      const chunks:string[]=[];await workspaceDataExport(a,async s=>{chunks.push(s);});
      const result=JSON.parse(chunks.join("")),events=result.data.paymentEvents;
      assert.equal(events.length,4);assert.equal(new Set(events.map((e:{id:string})=>e.id)).size,4);
      assert.ok(events.every((e:{reference:string})=>e.reference!=="synthetic-charge-"+otherOrder));
      assert.equal(result.data.refundHistory.length,1);assert.equal(result.data.disputes.length,1);
      assert.equal(result.data.privacyRequests.length,2);assert.ok(!JSON.stringify(result).includes("nestedFullSnapshot"));
      assert.ok(!JSON.stringify(result).includes(publicIntake));assert.ok(!JSON.stringify(result).includes("objectKey"));
    });
    await act("start_erasure");
    assert.equal((await db.select().from(valoDisputeActions).where(eq(valoDisputeActions.id,action)))[0]!.status,"cancelled");
    for(let n=0;n<70&&detail.request.status!=="partially_fulfilled";n++)await act("resume_erasure");
    await t.test("all recorded copied private text is erased while finance facts and signed history remain",async()=>{
      assert.equal(detail.request.status,"partially_fulfilled");
      assert.ok(detail.steps.some(s=>s.status==="held"));
      const tables=["valo_orders","valo_refund_requests","valo_refund_transitions","valo_dispute_information",
        "valo_dispute_actions","valo_privacy_cases","valo_privacy_events","valo_support_tickets","valo_ai_drafts"];
      for(const table of tables){
        const rows=await db.execute(sql`SELECT to_jsonb(t) AS value FROM ${sql.identifier(table)} t WHERE workspace_id=${a.workspaceId}::uuid`);
        assert.ok(!JSON.stringify(rows.rows).includes(marker),table+" retained private text");
      }
      const[o]=await db.select().from(valoOrders).where(eq(valoOrders.id,order));
      assert.equal(o.amountKobo,100);assert.equal(o.checkoutUrl,null);assert.equal(o.requestedBy,"privacy-erased");
      const[di]=await db.select().from(valoDisputeActions).where(eq(valoDisputeActions.id,action));
      assert.deepEqual(di.payload,{amountKobo:50});assert.equal(di.result,null);
      assert.equal((await db.select().from(valoPrivacyMessages).where(eq(valoPrivacyMessages.workspaceId,a.workspaceId))).length,0);
      await db.transaction(tx=>readPrivacyCase(tx,caseId)); // Actual signed chain with JSONB-redaction witnesses.
      assert.equal((await db.select().from(valoAccessSupport).where(eq(valoAccessSupport.id,publicIntake)))[0]!.message,marker);
      assert.equal((await db.select().from(valoOrders).where(eq(valoOrders.id,otherOrder)))[0]!.checkoutUrl,"https://example.invalid/"+marker);
      const foreign=await db.select().from(valoPaymentEvents).where(eq(valoPaymentEvents.reference,"synthetic-charge-"+otherOrder));
      assert.equal(foreign[0]!.failure,marker);
      const owned=await db.execute(sql`SELECT failure FROM valo_payment_events WHERE reference=${"synthetic-dispute-"+dispute}`);
      assert.equal(owned.rows[0]!.failure,"PRIVACY_ERASURE_FINANCE_REVIEW");
      assert.equal(await budget(),usageBefore,"shared genuine usage ledger changed");
    });
    await t.test("every object alias and abandoned scratch path remains signed and retryable after process leftovers",async()=>{
      assert.equal(new Set(removed).size,2);
      await assert.rejects(()=>access(workspaceExportScratch(attempt)));
      const inventory=await db.execute(sql`SELECT object_key,status FROM valo_privacy_erasure_objects WHERE case_id=${caseId}::uuid`);
      assert.equal(inventory.rows.length,4);assert.ok(inventory.rows.every(r=>r.status==="deleted"));
      await mkdir(workspaceExportScratch(attempt),{recursive:true});await writeFile(join(workspaceExportScratch(attempt),"workspace.json"),marker);
      await replayErasureObjects(caseId,async()=>{});
      await assert.rejects(()=>access(workspaceExportScratch(attempt)));
      await assert.rejects(()=>db.execute(sql`UPDATE valo_refund_transitions SET reason='forged' WHERE refund_id=${refund}::uuid`));
      await assert.rejects(()=>db.execute(sql`UPDATE valo_privacy_redactions SET mac='forged' WHERE workspace_id=${a.workspaceId}::uuid`));
      const before=createHash("sha256").update(JSON.stringify(inventory.rows)).digest("hex");assert.equal(before.length,64);
    });
    console.log(JSON.stringify({scope:"new synthetic fixtures only",financialFactsRetained:true,externalProviderActions:0,
      completeAccountDeletionClaimed:false,sharedUsageUnchanged:true,fixtureWorkspace:a.workspaceId}));
  }finally{
    // Minimal financial/audit/tombstone records intentionally remain; deletion
    // of their facts or unrelated shared masters is not part of this drill.
    await db.update(valoStaffAssignments).set({active:false}).where(eq(valoStaffAssignments.identityId,staff.identityId));
    await closePrivacyErasureLocks();await pool.end();
  }
});
