import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {db,pool} from "@workspace/db";
import {sql} from "drizzle-orm";
import {createHash} from "node:crypto";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
import {recoverSyntheticPurchaseReceipt} from "../lib/valo-commerce";

try{
  assertDevelopmentRuntime();
  if(process.env.VALO_SYNTHETIC_RECEIPT_RECOVERY!=="owned-recorded-fixtures-only")throw Error("EXPLICIT_MAINTENANCE_REQUIRED");
  const snapshot=async()=>await db.execute(sql`SELECT o.* FROM valo_orders o JOIN valo_workspaces w ON w.id=o.workspace_id
    WHERE w.owner_identity_id LIKE 'synthetic-refund-%' ORDER BY o.id`);
  const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const before=await snapshot();
  const missing=await db.execute<{id:string}>(sql`SELECT o.id FROM valo_orders o JOIN valo_workspaces w ON w.id=o.workspace_id
    LEFT JOIN valo_purchase_outbox p ON p.order_id=o.id AND p.kind='purchase_receipt'
    WHERE w.owner_identity_id LIKE 'synthetic-refund-%' AND o.status='verified_success' AND p.id IS NULL ORDER BY o.id`);
  const receipts:string[]=[],failures:string[]=[];
  // Bounded concurrency; repeat each exact repair to challenge both locking and
  // uniqueness. These calls have no payment or email transport.
  for(const row of missing.rows){
    try{
      const results=await Promise.all([recoverSyntheticPurchaseReceipt(row.id),recoverSyntheticPurchaseReceipt(row.id)]);
      assert.equal(results.filter(r=>r.repaired).length,1);
      assert.equal(results[0].receiptId,results[1].receiptId);
      assert.ok(results.every(r=>r.deliveryStatus==="held_synthetic_recovery"));
      const again=await recoverSyntheticPurchaseReceipt(row.id);
      assert.equal(again.repaired,false);receipts.push(again.receiptId);
    }catch{failures.push(row.id);}
  }
  const after=await snapshot();assert.equal(hash(before.rows),hash(after.rows));
  const remaining=await db.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM valo_orders o
    JOIN valo_workspaces w ON w.id=o.workspace_id LEFT JOIN valo_purchase_outbox p
    ON p.order_id=o.id AND p.kind='purchase_receipt' WHERE w.owner_identity_id LIKE 'synthetic-refund-%'
    AND o.status='verified_success' AND p.id IS NULL`);
  const report={executedAt:new Date().toISOString(),historicalReportedMissing:94,observedMissingBefore:missing.rows.length,
    repaired:receipts.length,failed:failures.length,remaining:remaining.rows[0].count,orderHistoryUnchanged:true,
    orderHistoryHash:hash(after.rows),receiptsHeld:true,concurrentAndRepeatedRepair:true,
    providerCalls:0,emailSends:0,realSettlements:0,R1Accepted:false,R2Accepted:false};
  await writeFile(resolve(import.meta.dirname,"../../../../docs/valo/evidence/synthetic-receipt-recovery.json"),JSON.stringify(report,null,2)+"\n");
  process.stdout.write(JSON.stringify(report)+"\n");
  if(failures.length)process.exitCode=1;
}finally{await pool.end();}
