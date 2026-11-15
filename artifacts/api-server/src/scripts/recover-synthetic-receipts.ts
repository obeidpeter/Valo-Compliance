import {mkdir,writeFile,readFile,open,type FileHandle} from "node:fs/promises";
import {resolve} from "node:path";
import {db,pool} from "@workspace/db";
import {sql} from "drizzle-orm";
import {createHash,randomUUID} from "node:crypto";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
import {recoverSyntheticPurchaseReceipt} from "../lib/valo-commerce";
import {recoverReceiptWithEvidence,safeReceiptRecoveryFailure,type ReceiptRecoveryOutcome} from "../lib/valo-receipt-recovery-report";

let journal:FileHandle|undefined;
try{
  assertDevelopmentRuntime();
  if(process.env.VALO_SYNTHETIC_RECEIPT_RECOVERY!=="owned-recorded-fixtures-only")throw Error("EXPLICIT_MAINTENANCE_REQUIRED");
  const runId=randomUUID();
  const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const bytesHash=(v:string)=>createHash("sha256").update(v).digest("hex");
  const evidenceRoot=resolve(import.meta.dirname,"../../../../docs/valo/evidence");
  const originalBytes=await readFile(resolve(evidenceRoot,"synthetic-receipt-recovery.json"),"utf8");
  const laterBytes=await readFile(resolve(evidenceRoot,"synthetic-receipt-recovery-1794694677486.json"),"utf8");
  const original=JSON.parse(originalBytes),later=JSON.parse(laterBytes);
  if(original.executedAt!=="2026-11-14T21:49:33.657Z"||later.executedAt!=="2026-11-14T22:17:57.484Z")
    throw Error("DOCUMENTED_COHORT_BOUNDARY_CHANGED");
  // Do not widen maintenance to newer fixtures sharing the prefix. These IDs
  // have retained recovery audits by the later cutoff AND predate the original
  // report. Audit windows corroborate 76 + 18; they do not recover lost errors.
  const cohort=await db.execute<{id:string;first_recovered_at:Date}>(sql`
    SELECT o.id,min(e.created_at) first_recovered_at FROM valo_orders o
    JOIN valo_workspaces w ON w.id=o.workspace_id
    JOIN valo_events e ON e.entity_id=o.id AND e.workspace_id=o.workspace_id
    WHERE w.owner_identity_id LIKE 'synthetic-refund-%' AND o.created_at<=${new Date(original.executedAt)}
      AND e.action='payment.synthetic_receipt_recovered' AND e.actor_id='service:synthetic-receipt-recovery'
      AND e.created_at<=${new Date(later.executedAt)} GROUP BY o.id ORDER BY o.id`);
  const ids=cohort.rows.map(r=>r.id);
  const idList=sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`);
  const firstWindow=cohort.rows.filter(r=>new Date(r.first_recovered_at)<=new Date(original.executedAt)).length;
  if(ids.length!==94||new Set(ids).size!==94||firstWindow!==76)throw Error("DOCUMENTED_94_COHORT_NOT_ESTABLISHED");
  const directory=resolve(evidenceRoot,"synthetic-receipt-recovery-runs");
  await mkdir(directory,{recursive:true,mode:0o700});
  journal=await open(resolve(directory,runId+".jsonl"),"ax",0o600);
  let pending:Promise<void>=Promise.resolve();
  const record=(event:unknown)=>pending=pending.then(async()=>{
    await journal!.appendFile(JSON.stringify({runId,at:new Date().toISOString(),event})+"\n");await journal!.sync();
  });
  await record({stage:"cohort_bound",ids,firstWindow,laterWindow:ids.length-firstWindow,
    sourceReportHash:bytesHash(originalBytes),laterReportHash:bytesHash(laterBytes)});
  const snapshot=async()=>await db.execute(sql`SELECT o.* FROM valo_orders o WHERE o.id IN(${idList}) ORDER BY o.id`);
  const inspect=async(id:string)=>{
    const result=await db.execute(sql`SELECT o.id,o.status,o.amount_kobo,o.currency,
      o.requested_by=w.owner_identity_id requester_matches_owner,
      o.provider_transaction_id IS NOT NULL provider_reference_present,
      o.line->>'title' title,o.line->>'licenceVersion' licence_version,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'status',g.status,'matchesOrder',
        g.workspace_id=o.workspace_id AND g.content_version_id=(o.line->>'contentVersionId')::uuid) ORDER BY g.id),'[]')
        FROM valo_entitlements g WHERE g.order_id=o.id) grants,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'status',p.status,'createdAt',p.created_at)
        ORDER BY p.id),'[]') FROM valo_purchase_outbox p WHERE p.order_id=o.id) notifications,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'at',e.created_at) ORDER BY e.created_at,e.id),'[]')
        FROM valo_events e WHERE e.entity_id=o.id AND e.workspace_id=o.workspace_id
          AND e.action IN('payment.synthetic_receipt_recovered','payment.fulfilment_repaired')) recovery_audits
      FROM valo_orders o JOIN valo_workspaces w ON w.id=o.workspace_id WHERE o.id=${id}::uuid`);
    return result.rows[0]??null;
  };
  const missingReceipts=async()=>await db.execute<{id:string}>(sql`SELECT o.id FROM valo_orders o
    WHERE o.id IN(${idList}) AND NOT EXISTS(SELECT 1 FROM valo_purchase_outbox p
      WHERE p.order_id=o.id AND p.kind='purchase_receipt') ORDER BY o.id`);
  const before=await snapshot(),missing=await missingReceipts();
  const outcomes:(ReceiptRecoveryOutcome&{firstRecoveryAuditAt:string;originalFailureCause:"not_recorded";
    historicalWindow:string;provenanceBefore:unknown;provenanceAfter:unknown})[]=[];
  // At most two concurrent repairs; await both and preserve partial successes
  // or failed post-repair checks instead of discarding their order identities.
  for(const row of cohort.rows){
    const provenanceBefore=await inspect(row.id);
    await record({stage:"provenance_before",orderId:row.id,provenance:provenanceBefore});
    let attempt=0;
    const outcome=await recoverReceiptWithEvidence(row.id,async id=>{
      const number=++attempt;await record({stage:"attempt_intent",orderId:id,attempt:number});
      try{
        const result=await recoverSyntheticPurchaseReceipt(id);
        await record({stage:"attempt_result",orderId:id,attempt:number,result});return result;
      }catch(error){
        await record({stage:"attempt_error",orderId:id,
          error:safeReceiptRecoveryFailure(error,number===3?"repeat_check":"concurrent_repair",number)});throw error;
      }
    });
    outcomes.push({...outcome,firstRecoveryAuditAt:new Date(row.first_recovered_at).toISOString(),
      originalFailureCause:"not_recorded",historicalWindow:new Date(row.first_recovered_at)<=new Date(original.executedAt)?
        "recovery_recorded_by_first_report":"later_recovery_window_consistent_with_18_not_original_attempt_proof",
      provenanceBefore,provenanceAfter:await inspect(row.id)});
    await record({stage:"order_outcome",outcome:outcomes.at(-1)});
  }
  // A failed observation after committed repairs must not discard their IDs
  // and outcomes. Unknown post-checks remain null and make the run fail.
  const postCheckFailures:string[]=[];
  const after=await snapshot().catch(()=>{postCheckFailures.push("post_repair_order_snapshot_unavailable");return null;});
  const remaining=await missingReceipts().catch(()=>{postCheckFailures.push("remaining_receipt_query_unavailable");return null;});
  const repaired=outcomes.filter(r=>r.disposition==="repaired");
  const failures=outcomes.filter(r=>r.disposition==="needs_review");
  const orderHistoryUnchanged=after?hash(before.rows)===hash(after.rows):null;
  const protectedEvidence=(p:unknown)=>{
    const value=p as {grants:unknown;notifications:{kind:string}[]}|null;
    return value?{grants:value.grants,refundNotices:value.notifications.filter(n=>n.kind!=="purchase_receipt")}:null;
  };
  const grantAndRefundHistoryUnchanged=outcomes.every(o=>o.provenanceBefore&&o.provenanceAfter&&
    hash(protectedEvidence(o.provenanceBefore))===hash(protectedEvidence(o.provenanceAfter)));
  const report={schemaVersion:3,runId,executedAt:new Date().toISOString(),
    historical:{report:"docs/valo/evidence/synthetic-receipt-recovery.json",reportedMissing:94,reportedRepaired:76,
      reportedFailed:18,failedOrderIds:"not_recorded",individualFailureResolution:"not_reconstructable_from_aggregate_reports",
      laterAggregateReports:["synthetic-receipt-recovery-1794694677486.json","synthetic-receipt-recovery-1794694681099.json"],
      originalReportHash:bytesHash(originalBytes),laterReportHash:bytesHash(laterBytes),
      firstAuditWindowCount:firstWindow,laterAuditWindowCount:ids.length-firstWindow,
      causeClaim:"The shared-kind defect is plausible; original per-attempt errors were not retained."},
    cohortOrderIds:ids,cohortHash:hash(ids),
    grantAndRefundHistoryUnchanged,
    observedMissingBefore:missing.rows.length,repaired:repaired.length,
    alreadyPresent:outcomes.filter(r=>r.disposition==="already_present").length,needsReview:failures.length,
    remaining:remaining?.rows.length??null,remainingOrderIds:remaining?.rows.map(r=>r.id)??null,outcomes,postCheckFailures,
    orderHistoryUnchanged,orderHistoryHashBefore:hash(before.rows),orderHistoryHashAfter:after?hash(after.rows):null,
    repairedReceiptsHeld:repaired.length?repaired.every(r=>r.observations.every(o=>o.deliveryStatus==="held_synthetic_recovery")):null,
    concurrentAndRepeatedChecksPassed:outcomes.length?outcomes.every(r=>r.disposition!=="needs_review"):null,
    providerCalls:0,emailSends:0,realSettlements:0,R1Accepted:false,R2Accepted:false};
  // Preserve the original 76/18 report and every new execution; UUID names are
  // generated here, never supplied by a customer. Do not reconstruct lost IDs.
  await writeFile(resolve(directory,runId+".json"),JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  process.stdout.write(JSON.stringify(report)+"\n");
  if(failures.length||postCheckFailures.length||(remaining?.rows.length??0)>0||
    orderHistoryUnchanged!==true||!grantAndRefundHistoryUnchanged)process.exitCode=1;
}finally{await journal?.close();await pool.end();}

