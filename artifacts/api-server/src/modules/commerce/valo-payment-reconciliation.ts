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
import { SettleFinancePaymentCheckBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import { singleRow } from "../../platform/rows";
import { orderEditions } from "./checkout-editions";
import { settleVerifiedOrder } from "./valo-commerce";
import { orderDifferences, paystack, sandboxPaymentsConfigured } from "./valo-paystack-contract";
import { refundBalance } from "./valo-refund-provider";
import { requireFinance, type FinanceActor } from "./valo-refunds";

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

/**
 * A check whose difference nobody has settled (docs/architecture/reconciliation.md, slice 2): its order's
 * latest finished check, needing review, where no earlier settlement of the order covers every name its
 * finding gives, with no check that matched since. The operations reading `paymentDifferences` counts the
 * same rows, and a test holds the two together.
 */
const unsettled = sql`r.status = 'needs_review'
  AND NOT EXISTS (SELECT 1 FROM valo_payment_reconciliations n
    WHERE n.order_id = r.order_id AND n.day > r.day AND n.status <> 'pending')
  AND NOT EXISTS (SELECT 1 FROM valo_payment_reconciliations s
    WHERE s.order_id = r.order_id AND s.status = 'resolved' AND s.day < r.day
      AND string_to_array(r.finding, ';') <@ string_to_array(s.finding, ';')
      AND NOT EXISTS (SELECT 1 FROM valo_payment_reconciliations m
        WHERE m.order_id = r.order_id AND m.status = 'matched' AND m.day > s.day AND m.day < r.day))`;
type CheckRow = {
  id: string;
  order_id: string;
  reference: string;
  amount_kobo: number;
  currency: string;
  order_status: string;
  day: string;
  status: "needs_review" | "resolved";
  finding: string;
  attempts: number;
  outcome: "explained" | "no_payment_stands" | null;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  reason: string | null;
};
const checkColumns = sql`r.id, r.order_id, o.reference, o.amount_kobo, o.currency, o.status AS order_status,
  r.day, r.status, r.finding, r.attempts, r.outcome, r.resolved_at, r.resolved_by`;
function checkView(actor: FinanceActor, row: CheckRow) {
  return {
    id: row.id,
    orderId: row.order_id,
    reference: row.reference,
    amountKobo: Number(row.amount_kobo),
    currency: row.currency,
    orderStatus: row.order_status,
    day: row.day,
    status: row.status,
    finding: row.finding,
    attempts: row.attempts,
    outcome: row.outcome,
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
    resolvedByYou: row.resolved_by === actor.identityId,
    reason: row.reason,
  };
}
const SETTLEMENT_REASON = /^Payment check [0-9a-f-]{36}: (?:explained|no_payment_stands); /;

/** Finance's view of the daily checks: the differences nobody has settled, and the latest settlements with
 * what finance found and why (PAY-007). */
export async function financePaymentChecks(actor: FinanceActor) {
  return db.transaction(async (tx) => {
    await requireFinance(
      tx,
      actor,
      "Read the daily payment checks' differences and settlements; no private document bodies.",
      "payment_checks",
    );
    const differences = await tx.execute<CheckRow>(sql`SELECT ${checkColumns}, NULL::text AS reason
      FROM valo_payment_reconciliations r
      JOIN valo_orders o ON o.id = r.order_id AND o.workspace_id = r.workspace_id
      WHERE ${unsettled} ORDER BY r.day DESC, r.id LIMIT 100`);
    const settled = await tx.execute<CheckRow>(sql`SELECT ${checkColumns},
        (SELECT a.reason FROM valo_staff_access_audit a WHERE a.object = 'payment_check:' || r.id::text
          AND a.actor_id = r.resolved_by AND a.created_at = r.resolved_at ORDER BY a.id LIMIT 1) AS reason
      FROM valo_payment_reconciliations r
      JOIN valo_orders o ON o.id = r.order_id AND o.workspace_id = r.workspace_id
      WHERE r.status = 'resolved' ORDER BY r.resolved_at DESC, r.id LIMIT 50`);
    return {
      differences: differences.rows.map((row) => checkView(actor, row)),
      settled: settled.rows.map((row) =>
        checkView(actor, { ...row, reason: row.reason?.replace(SETTLEMENT_REASON, "") ?? null }),
      ),
    };
  });
}

/**
 * Finance records what it found about a difference a daily check found (docs/architecture/reconciliation.md,
 * slice 2): `explained`, or `no_payment_stands` for an order Valo does not hold as paid. The check is marked
 * settled, and the reason kept in the staff access audit, in one transaction. Nothing about the order, its
 * payment or its grants is changed. The database's guard `valo_payment_checks_kept` refuses a settlement
 * made any other way.
 */
export async function settlePaymentCheck(actor: FinanceActor, id: string, raw: unknown) {
  const input = SettleFinancePaymentCheckBody.strict().parse(raw);
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select({
        orderId: valoPaymentReconciliations.orderId,
        workspaceId: valoPaymentReconciliations.workspaceId,
      })
      .from(valoPaymentReconciliations)
      .where(eq(valoPaymentReconciliations.id, id));
    if (!link) throw new ValoProblem(404, "Payment check not found.");
    // The same order of locks as a settlement of the order: the workspace's, then the order's.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${link.workspaceId}::text))`);
    const order = singleRow(
      await tx
        .select({ status: valoOrders.status })
        .from(valoOrders)
        .where(and(eq(valoOrders.id, link.orderId), eq(valoOrders.workspaceId, link.workspaceId)))
        .for("share"),
    );
    await requireFinance(
      tx,
      actor,
      `Payment check ${id}: ${input.outcome}; ${input.reason}`,
      `payment_check:${id}`,
    );
    const [open] = await tx
      .execute<{ id: string }>(
        sql`SELECT r.id FROM valo_payment_reconciliations r
      WHERE r.id = ${id}::uuid AND ${unsettled} FOR UPDATE`,
      )
      .then((result) => result.rows);
    if (!open)
      throw new ValoProblem(
        409,
        "This check is not a difference waiting to be settled: it has been settled, a later check has been made, or it found nothing. Refresh the list.",
      );
    if (input.outcome === "no_payment_stands" && order.status === "verified_success")
      throw new ValoProblem(
        409,
        "Valo holds this order as paid, so it cannot be settled as having no payment. Explain the difference instead, or ask engineering.",
      );
    const [settledRow] = await tx
      .update(valoPaymentReconciliations)
      .set({
        status: "resolved",
        outcome: input.outcome,
        resolvedBy: actor.identityId,
        resolvedAt: sql`now()`,
      })
      .where(
        and(eq(valoPaymentReconciliations.id, id), eq(valoPaymentReconciliations.status, "needs_review")),
      )
      .returning({ id: valoPaymentReconciliations.id });
    if (!settledRow)
      throw new ValoProblem(409, "This check changed while it was being settled. Refresh the list.");
    const [row] = await tx
      .execute<CheckRow>(
        sql`SELECT ${checkColumns}, ${input.reason}::text AS reason
      FROM valo_payment_reconciliations r
      JOIN valo_orders o ON o.id = r.order_id AND o.workspace_id = r.workspace_id
      WHERE r.id = ${id}::uuid`,
      )
      .then((result) => result.rows);
    return checkView(actor, row!);
  });
}
