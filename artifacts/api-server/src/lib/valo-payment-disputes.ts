import {randomUUID,createHash} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import {z} from "zod";
import {db,valoOrders,valoEntitlements,valoPaymentDisputes,valoEvents} from "@workspace/db";
import {paystackRequest,sandboxPaymentsConfigured} from "./valo-paystack-contract";
import {ValoProblem} from "./valo-problem";
const id=z.union([z.string().regex(/^\d{1,40}$/),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
export const verifiedDispute=z.object({id,domain:z.literal("test"),status:z.enum(["awaiting-merchant-feedback","awaiting-bank-feedback","pending","resolved","archived"]),
  resolution:z.string().max(100).nullable(),refund_amount:z.number().int().nonnegative().max(2147483647).nullable(),
  category:z.string().max(100).nullable().optional(),updatedAt:z.string().datetime().optional(),
  evidence:z.unknown().optional(),
  currency:z.literal("NGN").nullable(),transaction:z.object({id,domain:z.literal("test"),reference:z.string().max(150),
    amount:z.number().int().positive().max(2147483647),currency:z.literal("NGN")})});
export function disputeSnapshotHash(data:ReturnType<typeof verifiedDispute.parse>){
  return createHash("sha256").update(JSON.stringify({id:data.id,transaction:data.transaction,status:data.status,
    resolution:data.resolution,refund_amount:data.refund_amount,category:data.category??null,
    updatedAt:data.updatedAt??null,evidence:data.evidence??null})).digest("hex");
}
/** Only call with a server-fetched canonical dispute, never with webhook data.
 * No bank evidence, card data, customer payload or attachment is retained. */
export async function storeVerifiedDispute(providerId:string,raw:unknown){
  const data=verifiedDispute.parse(raw);
  if(data.id!==providerId)throw new ValoProblem(409,"Dispute identity mismatch.");
  return db.transaction(async tx=>{
    const[order]=await tx.select().from(valoOrders).where(and(eq(valoOrders.providerTransactionId,data.transaction.id),
      eq(valoOrders.reference,data.transaction.reference))).for("update");
    if(!order||order.amountKobo!==data.transaction.amount||data.refund_amount!==null&&data.refund_amount>order.amountKobo)
      throw new ValoProblem(409,"Dispute does not match a known test order and amount.");
    const[old]=await tx.select().from(valoPaymentDisputes).where(eq(valoPaymentDisputes.providerId,providerId));
    if(old&&old.orderId!==order.id)throw new ValoProblem(409,"Dispute is already bound to another order.");
    const snapshotHash=disputeSnapshotHash(data),providerUpdatedAt=data.updatedAt?new Date(data.updatedAt):null;
    if(old?.providerUpdatedAt&&(!providerUpdatedAt||providerUpdatedAt<old.providerUpdatedAt))return old;
    if(old?.providerUpdatedAt&&providerUpdatedAt?.getTime()===old.providerUpdatedAt.getTime()&&
      old.snapshotHash&&old.snapshotHash!==snapshotHash)throw new ValoProblem(409,"Contradictory canonical dispute versions require reconciliation.");
    // A late/reordered response cannot reopen a terminal provider observation.
    if(old&&["resolved","archived"].includes(old.status)&&!["resolved","archived"].includes(data.status))return old;
    const values={status:data.status,resolution:data.resolution,amountKobo:data.refund_amount,checkedAt:new Date(),
      providerUpdatedAt,snapshotHash,category:data.category??null};
    const[row]=await tx.insert(valoPaymentDisputes).values({id:randomUUID(),workspaceId:order.workspaceId,
      orderId:order.id,providerId,...values}).onConflictDoUpdate({target:valoPaymentDisputes.providerId,set:values}).returning();
    // Terminal/archived is not a documented final bank outcome. Do not newly
    // suspend from that status alone, or restore access held for another reason.
    if(!["resolved","archived"].includes(data.status))
      await tx.update(valoEntitlements).set({status:"suspended"}).where(and(eq(valoEntitlements.orderId,order.id),
        eq(valoEntitlements.status,"active")));
    await tx.insert(valoEvents).values({id:randomUUID(),workspaceId:order.workspaceId,actorId:"service:dispute-verifier",
      action:"payment.dispute_observed",entityId:row.id});
    return row;
  });
}
export async function syncDispute(providerId:string){
  if(!sandboxPaymentsConfigured())return false;
  id.parse(providerId);
  await storeVerifiedDispute(providerId,await paystackRequest("/dispute/"+encodeURIComponent(providerId)));
  return true;
}
export async function reconcileKnownDisputes(){
  if(!sandboxPaymentsConfigured())return;
  const rows=await db.select().from(valoPaymentDisputes)
    .where(sql`${valoPaymentDisputes.checkedAt} < now()-interval '1 hour'`).limit(10);
  for(const row of rows){
    try{await syncDispute(row.providerId);}catch{/* Leave the last verified state; never infer a bank resolution. */}
  }
}
