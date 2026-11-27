import { and, eq, sql } from "drizzle-orm";
import {
  db,
  valoEntitlements,
  valoOrders,
  valoPaymentReconciliations,
  valoPurchaseOutbox,
} from "@workspace/db";
import { singleRow } from "../../platform/rows";
import { settleVerifiedOrder } from "./valo-commerce";
import { paystack, sandboxPaymentsConfigured } from "./valo-paystack-contract";
/** Durable daily reconciliation queue. A worker restart cannot erase the day/order key.
 * Missing credentials do not consume attempts or manufacture matched results. */
export async function reconcilePayments() {
  if (!sandboxPaymentsConfigured()) return;
  await db.execute(sql`insert into valo_payment_reconciliations(id,workspace_id,order_id,day)
    select gen_random_uuid(),workspace_id,id,to_char(now() at time zone 'UTC','YYYY-MM-DD')
    from valo_orders where status <> 'created'
    on conflict(order_id,day) do nothing`);
  const pending = await db
    .select()
    .from(valoPaymentReconciliations)
    .where(eq(valoPaymentReconciliations.status, "pending"))
    .limit(10);
  for (const job of pending) {
    try {
      const [order] = await db
        .select()
        .from(valoOrders)
        .where(and(eq(valoOrders.id, job.orderId), eq(valoOrders.workspaceId, job.workspaceId)));
      if (!order) throw new Error("ORDER_MISSING");
      await settleVerifiedOrder(order.id, await paystack.verify(order.reference));
      const [grant] = await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order.id));
      const [receipt] = await db
        .select()
        .from(valoPurchaseOutbox)
        .where(
          and(eq(valoPurchaseOutbox.orderId, order.id), eq(valoPurchaseOutbox.kind, "purchase_receipt")),
        );
      const current = singleRow(await db.select().from(valoOrders).where(eq(valoOrders.id, order.id)));
      const gaps =
        current.status === "verified_success"
          ? [
              ...(grant?.status !== "active" ? ["ENTITLEMENT_DIFFERENCE"] : []),
              ...(!receipt ? ["RECEIPT_OUTBOX_MISSING"] : []),
            ]
          : [];
      await db
        .update(valoPaymentReconciliations)
        .set({ status: gaps.length ? "needs_review" : "matched", finding: gaps.join(";") || null })
        .where(eq(valoPaymentReconciliations.id, job.id));
    } catch {
      await db.execute(sql`update valo_payment_reconciliations set attempts=LEAST(attempts+1,3),
        status=case when attempts>=2 then 'needs_review' else 'pending' end,
        finding='VERIFICATION_OR_FULFILMENT_DIFFERENCE' where id=${job.id} and status='pending'`);
    }
  }
}
