import { randomUUID, createHash } from "node:crypto";
import { syntheticReceiptBlockers } from "./valo-receipt-provenance";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import {
  db,
  valoPrices,
  valoOrders,
  valoEntitlements,
  valoPurchaseOutbox,
  valoRefundRequests,
  valoPaymentEvents,
  valoEvents,
  valoPaymentReconciliations,
  valoPaymentDisputes,
  valoWorkspaces,
} from "@workspace/db";
import { z } from "zod";
import { liveOperationalVersions } from "./valo-released-content";
import { authorizeWorkspaceWrite, ValoProblem, type WorkspaceActor } from "./valo-store";
import { consumeQuota, quotaSubjectHash } from "./valo-quota";
import {
  assertOrderMatch,
  paystack,
  verifiedTransaction,
  sandboxPaymentsConfigured,
  type VerifiedTransaction,
} from "./valo-paystack-contract";
import { trustedSiteOrigin } from "./valo-site-origin";
import { assertDevelopmentRuntime } from "./valo-development-runtime";
import { CreateCommerceOrderBody } from "@workspace/api-zod";
import { requestOrderRefund, refundView, handleRefundEvent } from "./valo-refunds";
import { syncDispute } from "./valo-payment-disputes";
import { refundBalance, TEST_REFUND_POLICY } from "./valo-refund-provider";
import { setting } from "../platform/settings";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const originalReceiptActions = ["payment.verified_success", "payment.synthetic_receipt_recovered"];
function audit(tx: Tx, workspaceId: string, actorId: string, action: string, id: string) {
  return tx.insert(valoEvents).values({ id: randomUUID(), workspaceId, actorId, action, entityId: id });
}
async function limit(tx: Tx, actor: WorkspaceActor) {
  const hash = quotaSubjectHash(setting("SESSION_SECRET"), "user", actor.identityId);
  for (const [window, max] of [
    ["minute", 10],
    ["day", 100],
  ] as const) {
    const q = await consumeQuota("checkout-create", hash, max, window, tx);
    if (!q.allowed)
      throw new ValoProblem(
        429,
        `Purchase request limit reached. Retry in ${q.retryAfter} seconds; saved orders are unchanged.`,
        undefined,
        q.retryAfter,
      );
  }
}
function display(
  order: typeof valoOrders.$inferSelect,
  refunds: (typeof valoRefundRequests.$inferSelect)[] = [],
  disputeStatus: string | null = null,
  originalReceipt = false,
) {
  return {
    id: order.id,
    reference: order.reference,
    title: order.line.title,
    amountKobo: order.amountKobo,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    lastCheckedAt: order.lastCheckedAt?.toISOString() ?? null,
    licenceVersion: order.line.licenceVersion,
    licenceText: order.line.licenceText,
    taxTreatment: order.line.taxTreatment,
    contentVersionId: order.line.contentVersionId,
    refundStatus: refunds[0]?.status ?? null,
    refunds: refunds.map(refundView),
    ...refundBalance(order.amountKobo, refunds),
    refundPolicy: TEST_REFUND_POLICY,
    disputeStatus,
    receiptReference:
      order.providerTransactionId && (order.status === "verified_success" || originalReceipt)
        ? `VALO-TEST-${order.reference}`
        : null,
  };
}
async function originalReceiptExists(tx: Tx, orderId: string, workspaceId: string) {
  const [row] = await tx
    .select({ id: valoEvents.id })
    .from(valoEvents)
    .where(
      and(
        eq(valoEvents.workspaceId, workspaceId),
        eq(valoEvents.entityId, orderId),
        inArray(valoEvents.action, originalReceiptActions),
      ),
    )
    .limit(1);
  return !!row;
}
async function presentOrder(tx: Tx, order: typeof valoOrders.$inferSelect) {
  const [dispute] = await tx
    .select()
    .from(valoPaymentDisputes)
    .where(eq(valoPaymentDisputes.orderId, order.id))
    .orderBy(desc(valoPaymentDisputes.checkedAt));
  return display(
    order,
    await tx
      .select()
      .from(valoRefundRequests)
      .where(eq(valoRefundRequests.orderId, order.id))
      .orderBy(desc(valoRefundRequests.createdAt)),
    dispute?.status ?? null,
    await originalReceiptExists(tx, order.id, order.workspaceId),
  );
}
export async function commerceProducts() {
  const released = await liveOperationalVersions(),
    ids = new Set(released.filter((v) => !/^TPL-(0[1-9]|1[0-2])$/.test(v.templateId)).map((v) => v.id)),
    now = Date.now();
  return (await db.select().from(valoPrices))
    .filter(
      (p) =>
        ids.has(p.contentVersionId) && +p.effectiveFrom <= now && (!p.effectiveTo || +p.effectiveTo > now),
    )
    .map((p) => ({
      id: p.id,
      title: p.title,
      amountKobo: p.amountKobo,
      currency: p.currency,
      licenceVersion: p.licenceVersion,
      licenceText: p.licenceText,
      taxTreatment: p.taxTreatment,
    }));
}
export async function purchases(actor: WorkspaceActor) {
  return db.transaction(async (tx) => {
    await authorizeWorkspaceWrite(tx, actor);
    const orders = await tx
      .select()
      .from(valoOrders)
      .where(eq(valoOrders.workspaceId, actor.workspaceId))
      .orderBy(desc(valoOrders.createdAt))
      .limit(100);
    const refunds = await tx
      .select()
      .from(valoRefundRequests)
      .where(eq(valoRefundRequests.workspaceId, actor.workspaceId))
      .orderBy(desc(valoRefundRequests.createdAt));
    const disputes = await tx
      .select()
      .from(valoPaymentDisputes)
      .where(eq(valoPaymentDisputes.workspaceId, actor.workspaceId))
      .orderBy(desc(valoPaymentDisputes.checkedAt));
    const originalReceipts = new Set(
      (
        await tx
          .select({ id: valoEvents.entityId })
          .from(valoEvents)
          .where(
            and(
              eq(valoEvents.workspaceId, actor.workspaceId),
              inArray(valoEvents.action, originalReceiptActions),
            ),
          )
      ).map((e) => e.id),
    );
    return {
      available: true,
      livePaymentsEnabled: false,
      message:
        "No live payments. Only server-verified Paystack test transactions can grant test purchases. Saved orders do not prove payment.",
      orders: orders.map((o) =>
        display(
          o,
          refunds.filter((r) => r.orderId === o.id),
          disputes.find((d) => d.orderId === o.id)?.status ?? null,
          originalReceipts.has(o.id),
        ),
      ),
      products: await commerceProducts(),
    };
  });
}
export async function createOrder(actor: WorkspaceActor, raw: unknown) {
  const input = CreateCommerceOrderBody.strict().parse(raw);
  return db.transaction(async (tx) => {
    // Serialize one tenant's idempotency/price selection without trusting browser prices.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.workspaceId}))`);
    const [old] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.workspaceId, actor.workspaceId), eq(valoOrders.requestKey, input.requestKey)));
    if (old) {
      await authorizeWorkspaceWrite(tx, actor);
      if (old.priceId !== input.priceId || old.line.licenceVersion !== input.acceptedLicenceVersion)
        throw new ValoProblem(
          409,
          "This request key belongs to another choice. Your original order is unchanged.",
        );
      return presentOrder(tx, old);
    }
    await limit(tx, actor);
    const [price] = await tx.select().from(valoPrices).where(eq(valoPrices.id, input.priceId)).for("share");
    await authorizeWorkspaceWrite(tx, actor);
    if (
      !price ||
      !price.approvalReference ||
      +price.effectiveFrom > Date.now() ||
      (price.effectiveTo && +price.effectiveTo <= Date.now()) ||
      !(await commerceProducts()).some((p) => p.id === price.id)
    )
      throw new ValoProblem(
        409,
        "This product is not currently released with an approved price and licence. No order was created.",
      );
    if (input.acceptedLicenceVersion !== price.licenceVersion)
      throw new ValoProblem(409, "The licence changed. Review the current licence before continuing.");
    const id = randomUUID();
    const [order] = await tx
      .insert(valoOrders)
      .values({
        id,
        workspaceId: actor.workspaceId,
        requestedBy: actor.identityId,
        requestKey: input.requestKey,
        reference: `valo-test-${id}`,
        priceId: price.id,
        amountKobo: price.amountKobo,
        currency: price.currency,
        line: {
          title: price.title,
          contentVersionId: price.contentVersionId,
          licenceVersion: price.licenceVersion,
          licenceText: price.licenceText,
          taxTreatment: price.taxTreatment,
        },
      })
      .returning();
    await audit(tx, actor.workspaceId, actor.identityId, "order.created", id);
    return presentOrder(tx, order);
  });
}
async function ownedOrder(tx: Tx, actor: WorkspaceActor, id: string) {
  const [order] = await tx
    .select()
    .from(valoOrders)
    .where(and(eq(valoOrders.id, id), eq(valoOrders.workspaceId, actor.workspaceId)))
    .for("update");
  if (!order) throw new ValoProblem(404, "Order not found.");
  await authorizeWorkspaceWrite(tx, actor);
  return order;
}
export async function startCheckout(actor: WorkspaceActor, id: string, email: string) {
  const order = await db.transaction(async (tx) => {
    const order = await ownedOrder(tx, actor, id);
    if (order.status === "verified_success")
      throw new ValoProblem(409, "This purchase is already verified. Do not pay again.");
    if (order.status === "needs_review" || order.status === "reversed")
      throw new ValoProblem(409, "This order needs staff reconciliation before any new payment.");
    await limit(tx, actor);
    if (!(await commerceProducts()).some((p) => p.id === order.priceId))
      throw new ValoProblem(
        409,
        "This product is unavailable for new checkout. Your order history and drafts are unchanged.",
      );
    return order;
  });
  if (order.checkoutUrl) return { url: order.checkoutUrl };
  const origin = trustedSiteOrigin();
  if (!origin) throw new ValoProblem(503, "The trusted checkout return address is not configured.");
  // No membership lock across provider I/O. Stable provider reference prevents
  // a retry from becoming a different order; never mint another reference on error.
  const url = await paystack.initialise(order, email, `${origin}/workspace/purchases`);
  return db.transaction(async (tx) => {
    const current = await ownedOrder(tx, actor, id);
    if (["verified_success", "reversed", "needs_review"].includes(current.status))
      throw new ValoProblem(
        409,
        "The order changed while checkout was starting. Refresh its status before continuing.",
      );
    if (current.checkoutUrl) return { url: current.checkoutUrl };
    await tx.update(valoOrders).set({ checkoutUrl: url, status: "pending" }).where(eq(valoOrders.id, id));
    await audit(tx, actor.workspaceId, actor.identityId, "checkout.initialised", id);
    return { url };
  });
}
/** Called ONLY with schema-validated data obtained by the server's verify API adapter.
 * Callback/status and durable webhook workers converge on this locked transaction. */
export async function settleVerifiedOrder(id: string, data: VerifiedTransaction, actor?: WorkspaceActor) {
  data = verifiedTransaction.parse(data);
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.id, id), ...(actor ? [eq(valoOrders.workspaceId, actor.workspaceId)] : [])))
      .for("update");
    if (!order) throw new ValoProblem(404, "Order not found.");
    if (actor) await authorizeWorkspaceWrite(tx, actor);
    assertOrderMatch(order, data);
    if (order.status === "reversed" && data.status !== "reversed")
      throw new ValoProblem(
        409,
        "A reversed payment requires audited staff reconciliation; it cannot be reactivated by a replay.",
      );
    if (order.providerTransactionId && order.providerTransactionId !== data.id)
      throw new ValoProblem(
        409,
        "A different provider transaction is already attached. Staff reconciliation is required.",
      );
    if (order.status === "verified_success" && data.status === "success") {
      await repairVerifiedFulfilment(tx, order, actor?.identityId ?? "service:paystack-verifier");
      return presentOrder(tx, order);
    }
    const status =
      data.status === "success"
        ? "verified_success"
        : data.status === "reversed"
          ? "reversed"
          : ["failed", "abandoned"].includes(data.status)
            ? data.status
            : "pending";
    // Never silently downgrade a completed purchase on a transient/pending response.
    if (order.status === "verified_success" && status !== "reversed") return presentOrder(tx, order);
    const [updated] = await tx
      .update(valoOrders)
      .set({ status, lastCheckedAt: new Date(), providerTransactionId: data.id })
      .where(eq(valoOrders.id, id))
      .returning();
    if (status === "verified_success") {
      await tx
        .insert(valoEntitlements)
        .values({
          id: randomUUID(),
          workspaceId: order.workspaceId,
          orderId: id,
          contentVersionId: order.line.contentVersionId,
        })
        .onConflictDoNothing();
      await tx
        .insert(valoPurchaseOutbox)
        .values({ id: randomUUID(), workspaceId: order.workspaceId, orderId: id })
        .onConflictDoNothing();
    }
    if (status === "reversed")
      await tx.update(valoEntitlements).set({ status: "suspended" }).where(eq(valoEntitlements.orderId, id));
    await audit(
      tx,
      order.workspaceId,
      actor?.identityId ?? "service:paystack-verifier",
      `payment.${status}`,
      id,
    );
    return presentOrder(tx, updated);
  });
}
export async function refreshOrder(actor: WorkspaceActor, id: string) {
  const order = await db.transaction(async (tx) => {
    const row = await ownedOrder(tx, actor, id);
    await limit(tx, actor);
    return row;
  });
  const data = await paystack.verify(order.reference);
  // Revalidates membership AFTER the network wait and resource lock.
  return settleVerifiedOrder(id, data, actor);
}
export async function purchaseReceipt(actor: WorkspaceActor, id: string) {
  return db.transaction(async (tx) => {
    const order = await ownedOrder(tx, actor, id);
    if (
      !order.providerTransactionId ||
      (order.status !== "verified_success" && !(await originalReceiptExists(tx, id, order.workspaceId)))
    )
      throw new ValoProblem(409, "There is no recorded verified original purchase receipt for this order.");
    const [delivery] = await tx
      .select()
      .from(valoPurchaseOutbox)
      .where(and(eq(valoPurchaseOutbox.orderId, id), eq(valoPurchaseOutbox.kind, "purchase_receipt")));
    return {
      ...(await presentOrder(tx, order)),
      notice:
        "Paystack test-mode Valo purchase receipt. Not a live payment, customer-generated business invoice, government receipt or official tax invoice.",
      deliveryStatus: delivery?.status ?? "not_queued",
    };
  });
}
/** Called only after canonical transaction verification under the order lock.
 * Never unsuspend an existing grant or bypass refund/dispute decisions. */
async function repairVerifiedFulfilment(
  tx: Tx,
  order: typeof valoOrders.$inferSelect,
  actorId: string,
  receiptStatus: "pending" | "held_synthetic_recovery" = "pending",
) {
  const [grant] = await tx.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order.id));
  const [receipt] = await tx
    .select()
    .from(valoPurchaseOutbox)
    .where(and(eq(valoPurchaseOutbox.orderId, order.id), eq(valoPurchaseOutbox.kind, "purchase_receipt")));
  let repaired = false;
  if (!grant) {
    const [refund] = await tx
      .select({ id: valoRefundRequests.id })
      .from(valoRefundRequests)
      .where(eq(valoRefundRequests.orderId, order.id))
      .limit(1);
    const [dispute] = await tx
      .select({ id: valoPaymentDisputes.id })
      .from(valoPaymentDisputes)
      .where(eq(valoPaymentDisputes.orderId, order.id))
      .limit(1);
    if (!refund && !dispute) {
      await tx
        .insert(valoEntitlements)
        .values({
          id: randomUUID(),
          workspaceId: order.workspaceId,
          orderId: order.id,
          contentVersionId: order.line.contentVersionId,
        })
        .onConflictDoNothing();
      repaired = true;
    }
  }
  if (!receipt) {
    await tx
      .insert(valoPurchaseOutbox)
      .values({
        id: randomUUID(),
        workspaceId: order.workspaceId,
        orderId: order.id,
        kind: "purchase_receipt",
        status: receiptStatus,
      })
      .onConflictDoNothing();
    repaired = true;
  }
  if (repaired) await audit(tx, order.workspaceId, actorId, "payment.fulfilment_repaired", order.id);
}
/** Explicit maintenance of retained synthetic refund fixtures, not provider
 * verification. Uses the same locked, unique, audited fulfilment repair but
 * refuses to manufacture a missing grant or an actual settlement. No HTTP route.
 * Recovered messages stay held even if delivery is configured later. */
export async function recoverSyntheticPurchaseReceipt(id: string) {
  assertDevelopmentRuntime();
  if (setting("VALO_SYNTHETIC_RECEIPT_RECOVERY") !== "owned-recorded-fixtures-only")
    throw new ValoProblem(403, "Explicit synthetic receipt maintenance is required.");
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(valoOrders).where(eq(valoOrders.id, id)).for("update");
    if (!order) throw new ValoProblem(404, "Order not found.");
    const [workspace] = await tx
      .select()
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, order.workspaceId));
    const [grant] = await tx
      .select()
      .from(valoEntitlements)
      .where(
        and(
          eq(valoEntitlements.orderId, id),
          eq(valoEntitlements.workspaceId, order.workspaceId),
          eq(valoEntitlements.contentVersionId, order.line.contentVersionId),
        ),
      );
    const blockers = syntheticReceiptBlockers({
      owner: workspace?.ownerIdentityId ?? null,
      requester: order.requestedBy,
      reference: order.reference,
      title: order.line.title,
      licence: order.line.licenceVersion,
      currency: order.currency,
      amount: order.amountKobo,
      status: order.status,
      providerReference: !!order.providerTransactionId,
      matchingGrant: !!grant,
    });
    if (blockers.length)
      throw Object.assign(
        new ValoProblem(
          409,
          "This row is not an eligible retained synthetic fixture. No receipt, entitlement or payment state was changed.",
        ),
        { code: "SYNTHETIC_RECEIPT_INELIGIBLE", blockers },
      );
    const [prior] = await tx
      .select()
      .from(valoPurchaseOutbox)
      .where(and(eq(valoPurchaseOutbox.orderId, id), eq(valoPurchaseOutbox.kind, "purchase_receipt")));
    if (prior)
      return {
        repaired: false,
        receiptId: prior.id,
        deliveryStatus: prior.status,
        realProviderVerification: false,
      };
    await repairVerifiedFulfilment(
      tx,
      order,
      "service:synthetic-receipt-recovery",
      "held_synthetic_recovery",
    );
    const [receipt] = await tx
      .select()
      .from(valoPurchaseOutbox)
      .where(and(eq(valoPurchaseOutbox.orderId, id), eq(valoPurchaseOutbox.kind, "purchase_receipt")));
    if (!receipt) throw Error("PURCHASE_RECEIPT_MISSING_AFTER_SHARED_REPAIR");
    await audit(
      tx,
      order.workspaceId,
      "service:synthetic-receipt-recovery",
      "payment.synthetic_receipt_recovered",
      id,
    );
    return {
      repaired: true,
      receiptId: receipt.id,
      deliveryStatus: receipt.status,
      realProviderVerification: false,
    };
  });
}
export async function requestRefund(actor: WorkspaceActor, id: string, raw: unknown) {
  return requestOrderRefund(actor, id, raw);
}
/** Persist only the minimum authenticated event facts, never card/customer payloads. */
export async function recordPaymentEvent(raw: Buffer) {
  const event = z
    .object({
      event: z.string().min(1).max(80),
      data: z
        .object({
          id: z
            .union([z.string().max(150), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
            .optional(),
          reference: z.string().max(150).optional(),
          refund_reference: z.string().max(150).nullable().optional(),
          transaction_reference: z.string().max(150).optional(),
        })
        .optional(),
    })
    .parse(JSON.parse(raw.toString("utf8")));
  const charge = event.event === "charge.success",
    refund = /^refund\.(pending|processing|needs-attention|failed|processed)$/.test(event.event),
    dispute = /^charge\.dispute\.(create|remind|resolve)$/.test(event.event);
  const supported = charge || refund || dispute;
  if (charge && (!event.data?.id || !event.data.reference))
    throw new ValoProblem(422, "A charge event requires its transaction ID and reference.");
  const reference = refund
    ? (event.data?.refund_reference ?? undefined)
    : dispute
      ? String(event.data?.id ?? "")
      : event.data?.reference;
  const bodyHash = createHash("sha256").update(raw).digest("hex");
  const id = randomUUID(),
    eventKey = `test:${event.event}:${event.data?.id ?? (refund ? reference : undefined) ?? bodyHash}`;
  const [inserted] = await db
    .insert(valoPaymentEvents)
    .values({
      id,
      eventKey,
      bodyHash,
      eventType: event.event,
      reference,
      status: supported ? "pending" : "ignored",
    })
    .onConflictDoNothing()
    .returning();
  return { received: true, duplicate: !inserted };
}
export async function processPaymentEvents() {
  if (!sandboxPaymentsConfigured()) return;
  const events = await db
    .select()
    .from(valoPaymentEvents)
    .where(eq(valoPaymentEvents.status, "pending"))
    .limit(20);
  for (const event of events) {
    try {
      if (!event.reference) throw new ValoProblem(409, "Missing reference");
      if (event.eventType.startsWith("refund.")) {
        if (!(await handleRefundEvent(event.reference))) continue;
        await db
          .update(valoPaymentEvents)
          .set({ status: "processed", failure: null })
          .where(eq(valoPaymentEvents.id, event.id));
        continue;
      }
      if (event.eventType.startsWith("charge.dispute.")) {
        if (!(await syncDispute(event.reference))) continue;
        await db
          .update(valoPaymentEvents)
          .set({ status: "processed", failure: null })
          .where(eq(valoPaymentEvents.id, event.id));
        continue;
      }
      const [order] = await db.select().from(valoOrders).where(eq(valoOrders.reference, event.reference));
      if (!order) throw new ValoProblem(409, "Unmatched reference");
      await settleVerifiedOrder(order.id, await paystack.verify(order.reference));
      await db
        .update(valoPaymentEvents)
        .set({ status: "processed", failure: null })
        .where(eq(valoPaymentEvents.id, event.id));
    } catch (error) {
      // Atomic attempts bound retries even across multiple worker processes.
      await db.execute(sql`update valo_payment_events set attempts=LEAST(attempts+1,5),
        status=case when attempts>=4 or ${error instanceof ValoProblem && error.status === 409} then 'needs_review' else 'pending' end,
        failure='SERVER_VERIFICATION_REQUIRED' where id=${event.id} and status='pending'`);
    }
  }
}
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
      const [current] = await db.select().from(valoOrders).where(eq(valoOrders.id, order.id));
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
