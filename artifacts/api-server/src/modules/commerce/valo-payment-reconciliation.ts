import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  valoEntitlements,
  valoOrders,
  valoPaymentDisputes,
  valoPaymentEvents,
  valoPaymentReconciliations,
  valoPurchaseOutbox,
  valoRefundRequests,
} from "@workspace/db";
import { singleRow } from "../../platform/rows";
import { orderEditions } from "./checkout-editions";
import { settleVerifiedOrder } from "./valo-commerce";
import { orderDifferences, paystack, sandboxPaymentsConfigured } from "./valo-paystack-contract";
import { refundBalance } from "./valo-refund-provider";

/** How long a waiting check is left alone after the provider gave no answer that could be used. */
export const RECONCILIATION_RETRY_MINUTES = 60;
/** How long after an order is paid its event may still be on its way. */
export const PAYMENT_EVENT_GRACE_MINUTES = 60;

type Check = typeof valoPaymentReconciliations.$inferSelect;
type Order = typeof valoOrders.$inferSelect;

/** Whether the record explains a paid order's suspended grant: its processed refunds come to its whole
 * amount, or a dispute is recorded against it. Those are the two things that suspend a paid order's grant. */
async function accessWithheldOnRecord(order: Order) {
  const refunds = await db
    .select()
    .from(valoRefundRequests)
    .where(
      and(eq(valoRefundRequests.orderId, order.id), eq(valoRefundRequests.workspaceId, order.workspaceId)),
    );
  if (refundBalance(order.amountKobo, refunds).refundedKobo >= order.amountKobo) return true;
  const [dispute] = await db
    .select({ id: valoPaymentDisputes.id })
    .from(valoPaymentDisputes)
    .where(
      and(eq(valoPaymentDisputes.orderId, order.id), eq(valoPaymentDisputes.workspaceId, order.workspaceId)),
    )
    .limit(1);
  return Boolean(dispute);
}

/** What Valo's own records lack for a paid order: a grant for an edition it names, its receipt, or the
 * provider's event for its payment (docs/architecture/reconciliation.md, slice 1). Nothing for an order
 * that is not paid. */
export async function paidOrderFindings(id: string) {
  const order = singleRow(await db.select().from(valoOrders).where(eq(valoOrders.id, id)));
  if (order.status !== "verified_success") return [];
  const grants = await db
    .select({ edition: valoEntitlements.contentVersionId, status: valoEntitlements.status })
    .from(valoEntitlements)
    .where(and(eq(valoEntitlements.orderId, id), eq(valoEntitlements.workspaceId, order.workspaceId)));
  const ungranted = orderEditions(order.line).some(
    (edition) => !grants.some((grant) => grant.edition === edition),
  );
  const withheld =
    grants.some((grant) => grant.status !== "active") && !(await accessWithheldOnRecord(order));
  const [receipt] = await db
    .select({ id: valoPurchaseOutbox.id })
    .from(valoPurchaseOutbox)
    .where(and(eq(valoPurchaseOutbox.orderId, id), eq(valoPurchaseOutbox.kind, "purchase_receipt")))
    .limit(1);
  const [event] = await db
    .select({ id: valoPaymentEvents.id })
    .from(valoPaymentEvents)
    .where(
      and(
        eq(valoPaymentEvents.reference, order.reference),
        eq(valoPaymentEvents.eventType, "charge.success"),
      ),
    )
    .limit(1);
  // An order is written as checked when it becomes paid, and not again while it stays paid. The time is
  // read on the database's clock, as the check's own times are.
  const [timing] = await db
    .select({
      paidForLong: sql<boolean>`${valoOrders.lastCheckedAt} <= now() - ${PAYMENT_EVENT_GRACE_MINUTES} * interval '1 minute'`,
    })
    .from(valoOrders)
    .where(eq(valoOrders.id, id));
  const paidForLong = timing?.paidForLong === true;
  return [
    ...(ungranted || withheld ? ["ENTITLEMENT_DIFFERENCE"] : []),
    ...(!receipt ? ["RECEIPT_OUTBOX_MISSING"] : []),
    ...(!event && paidForLong ? ["EVENT_MISSING"] : []),
  ];
}

/** One order's check. The provider's answer is compared with the order before anything is settled: an
 * answer that differs leaves the order as it is. Throws when the provider gives no answer that can be
 * used, or the answer cannot be recorded. */
async function orderFindings(job: Check) {
  const [order] = await db
    .select()
    .from(valoOrders)
    .where(and(eq(valoOrders.id, job.orderId), eq(valoOrders.workspaceId, job.workspaceId)));
  if (!order) throw new Error("ORDER_MISSING");
  const answer = await paystack.verify(order.reference);
  const differences = orderDifferences(order, answer);
  if (differences.length) return differences;
  await settleVerifiedOrder(order.id, answer);
  return paidOrderFindings(order.id);
}

/** Durable daily reconciliation queue (docs/architecture/reconciliation.md). A worker restart cannot
 * erase the day/order key. Missing credentials do not consume attempts or manufacture matched results. */
export async function reconcilePayments() {
  if (!sandboxPaymentsConfigured()) return;
  await db.execute(sql`insert into valo_payment_reconciliations(id,workspace_id,order_id,day)
    select gen_random_uuid(),workspace_id,id,to_char(now() at time zone 'UTC','YYYY-MM-DD')
    from valo_orders where status <> 'created'
    on conflict(order_id,day) do nothing`);
  // A row the provider gave no answer for waits an hour before its next attempt, so one that cannot be
  // answered does not hold up the others.
  const waiting = await db
    .select()
    .from(valoPaymentReconciliations)
    .where(
      and(
        eq(valoPaymentReconciliations.status, "pending"),
        or(
          isNull(valoPaymentReconciliations.lastAttemptAt),
          lte(
            valoPaymentReconciliations.lastAttemptAt,
            sql`now() - ${RECONCILIATION_RETRY_MINUTES} * interval '1 minute'`,
          ),
        ),
      ),
    )
    .limit(10);
  for (const job of waiting) {
    let findings: string[] | undefined;
    try {
      findings = await orderFindings(job);
    } catch {
      // No answer that could be used: the provider did not give one, or it could not be recorded. That
      // is not a difference. The attempt is counted below, and its cause is not written down: a
      // statement's failure can carry a customer's data.
    }
    if (findings)
      await db
        .update(valoPaymentReconciliations)
        .set({ status: findings.length ? "needs_review" : "matched", finding: findings.join(";") || null })
        .where(
          and(eq(valoPaymentReconciliations.id, job.id), eq(valoPaymentReconciliations.status, "pending")),
        );
    else
      await db.execute(sql`update valo_payment_reconciliations
        set attempts=LEAST(attempts+1,3), last_attempt_at=now(),
          status=case when attempts>=2 then 'needs_review' else 'pending' end,
          finding=case when attempts>=2 then 'NO_ANSWER' else finding end
        where id=${job.id} and status='pending'`);
  }
}
