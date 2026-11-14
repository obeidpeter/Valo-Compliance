import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {db,pool} from "@workspace/db";
import {sql} from "drizzle-orm";
import {createHash,randomUUID} from "node:crypto";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
import {recoverSyntheticPurchaseReceipt} from "../lib/valo-commerce";
import {recoverReceiptWithEvidence,type ReceiptRecoveryOutcome} from "../lib/valo-receipt-recovery-report";

try{
  assertDevelopmentRuntime();
  if(process.env.VALO_SYNTHETIC_RECEIPT_RECOVERY!=="owned-recorded-fixtures-only")throw Error("EXPLICIT_MAINTENANCE_REQUIRED");
  const runId=randomUUID();
  const snapshot=async()=>await db.execute(sql`SELECT o.* FROM valo_orders o JOIN valo_workspaces w ON w.id=o.workspace_id
    WHERE w.owner_identity_id LIKE 'synthetic-refund-%' ORDER BY o.id`);
  const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const missingReceipts=async()=>await db.execute<{id:string}>(sql`SELECT o.id FROM valo_orders o JOIN valo_workspaces w ON w.id=o.workspace_id
    LEFT JOIN valo_purchase_outbox p ON p.order_id=o.id AND p.kind='purchase_receipt'
    WHERE w.owner_identity_id LIKE 'synthetic-refund-%' AND o.status='verified_success' AND p.id IS NULL ORDER BY o.id`);
  const before=await snapshot(),missing=await missingReceipts();
  const outcomes:ReceiptRecoveryOutcome[]=[];
  // At most two concurrent repairs; await both and preserve partial successes
  // or failed post-repair checks instead of discarding their order identities.
  for(const row of missing.rows)outcomes.push(await recoverReceiptWithEvidence(row.id,recoverSyntheticPurchaseReceipt));
  // A failed observation after committed repairs must not discard their IDs
  // and outcomes. Unknown post-checks remain null and make the run fail.
  const postCheckFailures:string[]=[];
  const after=await snapshot().catch(()=>{postCheckFailures.push("post_repair_order_snapshot_unavailable");return null;});
  const remaining=await missingReceipts().catch(()=>{postCheckFailures.push("remaining_receipt_query_unavailable");return null;});
  const repaired=outcomes.filter(r=>r.disposition==="repaired");
  const failures=outcomes.filter(r=>r.disposition==="needs_review");
  const orderHistoryUnchanged=after?hash(before.rows)===hash(after.rows):null;
  const report={schemaVersion:2,runId,executedAt:new Date().toISOString(),
    historical:{report:"docs/valo/evidence/synthetic-receipt-recovery.json",reportedMissing:94,reportedRepaired:76,
      reportedFailed:18,failedOrderIds:"not_recorded",individualFailureResolution:"not_reconstructable_from_aggregate_reports",
      laterAggregateReports:["synthetic-receipt-recovery-1794694677486.json","synthetic-receipt-recovery-1794694681099.json"]},
    observedMissingBefore:missing.rows.length,repaired:repaired.length,
    alreadyPresent:outcomes.filter(r=>r.disposition==="already_present").length,needsReview:failures.length,
    remaining:remaining?.rows.length??null,remainingOrderIds:remaining?.rows.map(r=>r.id)??null,outcomes,postCheckFailures,
    orderHistoryUnchanged,orderHistoryHashBefore:hash(before.rows),orderHistoryHashAfter:after?hash(after.rows):null,
    repairedReceiptsHeld:repaired.length?repaired.every(r=>r.observations.every(o=>o.deliveryStatus==="held_synthetic_recovery")):null,
    concurrentAndRepeatedChecksPassed:outcomes.length?outcomes.every(r=>r.disposition!=="needs_review"):null,
    providerCalls:0,emailSends:0,realSettlements:0,R1Accepted:false,R2Accepted:false};
  // Preserve the original 76/18 report and every new execution; UUID names are
  // generated here, never supplied by a customer. Do not reconstruct lost IDs.
  const directory=resolve(import.meta.dirname,"../../../../docs/valo/evidence/synthetic-receipt-recovery-runs");
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(resolve(directory,runId+".json"),JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  process.stdout.write(JSON.stringify(report)+"\n");
  if(failures.length||postCheckFailures.length||(remaining?.rows.length??0)>0||orderHistoryUnchanged!==true)process.exitCode=1;
}finally{await pool.end();}

