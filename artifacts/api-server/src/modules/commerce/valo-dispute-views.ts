import { randomUUID, createHash } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  valoOrders,
  valoPaymentDisputes,
  valoDisputeInformation,
  valoDisputeActions,
  valoDisputeTransitions,
  valoPrivacyTombstones,
  valoEntitlements,
} from "@workspace/db";
import { SaveOrderDisputeInformationBody } from "@workspace/api-zod";
import {
  authorizeWorkspaceRead,
  authorizeWorkspaceWrite,
  limitWorkspaceWrite,
  type WorkspaceActor,
} from "../workspaces";
import { assertFinanceActor, requireFinance, type FinanceActor } from "./valo-refunds";
import { ValoProblem } from "../../platform/valo-problem";
import { disputeInformation, disputeTransport, type DisputeContext } from "./valo-dispute-provider";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Action = typeof valoDisputeActions.$inferSelect;
export type Order = typeof valoOrders.$inferSelect;

export const DISPUTE_POLICY =
  "test-dispute-v1: Customer statements and receipts are not independent delivery proof. Prepared, acknowledged and observed merchant decisions are not bank outcomes. Unknown attempts are never automatically re-sent. Pending refunds and merchant acceptances reserve their full amounts. Terminal observations alone do not change access; previous holds, refunds and reversals are not automatically undone. Customer drafts are never deleted. Financial evidence/history remain retained pending policy/hold review, not declared erased or removed from external processors.";

export function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sorted(x)]),
    );
  return v;
}

export const digest = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(sorted(v)))
    .digest("hex");

export async function readDispute(tx: Tx, id: string) {
  const [row] = await tx.select().from(valoPaymentDisputes).where(eq(valoPaymentDisputes.id, id));
  if (!row) throw new ValoProblem(404, "Dispute not found.");
  const [order] = await tx.select().from(valoOrders).where(eq(valoOrders.id, row.orderId));
  if (!order || row.orderId !== order.id || row.workspaceId !== order.workspaceId)
    throw new ValoProblem(409, "Dispute binding changed.");
  return { order, row };
}

export async function locked(tx: Tx, id: string) {
  const [link] = await tx.select().from(valoPaymentDisputes).where(eq(valoPaymentDisputes.id, id));
  if (!link) throw new ValoProblem(404, "Dispute not found.");
  const [order] = await tx.select().from(valoOrders).where(eq(valoOrders.id, link.orderId)).for("update");
  const [row] = await tx
    .select()
    .from(valoPaymentDisputes)
    .where(eq(valoPaymentDisputes.id, id))
    .for("update");
  if (!order || !row || row.orderId !== order.id || row.workspaceId !== order.workspaceId)
    throw new ValoProblem(409, "Dispute binding changed.");
  return { order, row };
}

export async function source(
  tx: Tx,
  order: Order,
  disputeId: string,
  informationId: string | null,
  readOnlyReconciliation = false,
) {
  const [binding] = await tx
    .select({ providerId: valoPaymentDisputes.providerId })
    .from(valoPaymentDisputes)
    .where(
      and(
        eq(valoPaymentDisputes.id, disputeId),
        eq(valoPaymentDisputes.workspaceId, order.workspaceId),
        eq(valoPaymentDisputes.orderId, order.id),
      ),
    );
  if (!binding) throw new ValoProblem(404, "Dispute source binding not found.");
  if (!readOnlyReconciliation) {
    const [t] = await tx
      .select({ id: valoPrivacyTombstones.id })
      .from(valoPrivacyTombstones)
      .where(eq(valoPrivacyTombstones.workspaceId, order.workspaceId));
    if (t)
      throw new ValoProblem(
        409,
        "Workspace deletion has fenced new evidence sharing. Retained financial data is not fresh sharing consent.",
      );
  }
  const [record] = informationId
    ? await tx
        .select()
        .from(valoDisputeInformation)
        .where(
          and(
            eq(valoDisputeInformation.id, informationId),
            eq(valoDisputeInformation.workspaceId, order.workspaceId),
            eq(valoDisputeInformation.orderId, order.id),
            eq(valoDisputeInformation.disputeId, disputeId),
          ),
        )
    : [];
  if (informationId && (!record || record.consentVersion !== "test-dispute-information-v1"))
    throw new ValoProblem(404, "Consented customer financial information not found for this dispute.");
  const hash = digest({
    disputeId,
    providerId: binding.providerId,
    orderId: order.id,
    workspaceId: order.workspaceId,
    reference: order.reference,
    transactionId: order.providerTransactionId,
    amountKobo: order.amountKobo,
    currency: order.currency,
    line: order.line,
    information: record?.information ?? null,
  });
  return { record, hash };
}

export function context(order: Order, providerId: string): DisputeContext {
  if (!order.providerTransactionId || order.currency !== "NGN")
    throw new ValoProblem(409, "A verified test transaction is required.");
  return {
    providerId,
    transactionId: order.providerTransactionId,
    reference: order.reference,
    amountKobo: order.amountKobo,
  };
}

export async function transition(tx: Tx, a: Action, actorId: string, status: string) {
  await tx.insert(valoDisputeTransitions).values({
    id: randomUUID(),
    workspaceId: a.workspaceId,
    orderId: a.orderId,
    actionId: a.id,
    actorId,
    status,
  });
}

/** Privacy erasure may cancel only provably unsent work. Unknown financial
 * mutations keep their liabilities and history. Follow order->action locking. */
export async function cancelUnsentDisputeWork(tx: Tx, workspaceId: string) {
  const rows = await tx
    .select()
    .from(valoDisputeActions)
    .where(
      and(
        eq(valoDisputeActions.workspaceId, workspaceId),
        sql`status IN ('prepared','submitting','dispatching','sending')`,
      ),
    )
    .limit(100);
  let count = 0;
  for (const a of rows) {
    await locked(tx, a.disputeId);
    const status = a.status === "prepared" && a.attempts === 0 ? "cancelled" : "unknown";
    const changed = await tx
      .update(valoDisputeActions)
      .set({
        status,
        version: a.version + 1,
        claimToken: null,
        failure: "PRIVACY_WORKSPACE_FENCED",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(valoDisputeActions.id, a.id),
          eq(valoDisputeActions.status, a.status),
          eq(valoDisputeActions.version, a.version),
        ),
      )
      .returning();
    if (changed[0]) {
      await transition(tx, changed[0], "service:privacy-erasure", status);
      count++;
    }
  }
  return { rowCount: count };
}

export function actionView(a: Action) {
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    version: a.version,
    attempts: a.attempts,
    payload: a.payload,
    result: a.result,
    failure: a.failure,
  };
}

export async function detail(
  tx: Tx,
  id: string,
  enabled = false,
  loaded?: { row: typeof valoPaymentDisputes.$inferSelect; order: Order },
) {
  const { row, order } = loaded ?? (await locked(tx, id));
  const actions = await tx
    .select()
    .from(valoDisputeActions)
    .where(eq(valoDisputeActions.disputeId, id))
    .orderBy(desc(valoDisputeActions.createdAt))
    .limit(100);
  return {
    id,
    orderReference: order.reference,
    amountKobo: order.amountKobo,
    status: row.status,
    resolution: row.resolution,
    providerId: row.providerId,
    held: row.held,
    controlVersion: row.controlVersion,
    category: row.category,
    entitlementStatus:
      (
        await tx
          .select({ status: valoEntitlements.status })
          .from(valoEntitlements)
          .where(eq(valoEntitlements.orderId, order.id))
      )[0]?.status ?? null,
    actions: actions.map(actionView),
    information: await tx
      .select()
      .from(valoDisputeInformation)
      .where(eq(valoDisputeInformation.disputeId, id))
      .limit(100),
    history: await tx
      .select()
      .from(valoDisputeTransitions)
      .where(eq(valoDisputeTransitions.orderId, order.id))
      .limit(100),
    executionEnabled: enabled,
    policy: DISPUTE_POLICY,
  };
}

export async function financeDispute(actor: FinanceActor, id: string) {
  await assertFinanceActor(actor);
  return db.transaction(async (tx) => {
    const loaded = await readDispute(tx, id);
    await requireFinance(tx, actor, "Inspect scoped dispute and customer-consented financial evidence.");
    return detail(tx, id, disputeTransport.configured(), loaded);
  });
}

export async function orderDisputeInformation(actor: WorkspaceActor, orderId: string) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.id, orderId), eq(valoOrders.workspaceId, actor.workspaceId)));
    if (!order) throw new ValoProblem(404, "Order not found.");
    await authorizeWorkspaceRead(tx, actor);
    const rows = await tx.select().from(valoPaymentDisputes).where(eq(valoPaymentDisputes.orderId, orderId));
    return {
      disputes: rows.map((r) => ({ id: r.id, status: r.status })),
      information: await tx
        .select()
        .from(valoDisputeInformation)
        .where(eq(valoDisputeInformation.orderId, orderId)),
      notice:
        "This saves your statement for the selected existing bank dispute. It does not create a bank dispute or prove delivery. With your consent, finance may send these exact fields and your verified account email to Paystack. Development only; no automatic sending.",
    };
  });
}

export async function saveDisputeInformation(
  actor: WorkspaceActor,
  email: string,
  orderId: string,
  raw: unknown,
) {
  const input = SaveOrderDisputeInformationBody.strict().parse(raw);
  const information = disputeInformation.parse({
    customer_email: email,
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    service_details: input.serviceDetails,
    ...(input.deliveryAddress ? { delivery_address: input.deliveryAddress } : {}),
    ...(input.deliveryDate ? { delivery_date: input.deliveryDate } : {}),
  });
  await db.transaction(async (tx) => {
    // Tenant concealment precedes an unscoped dispute lookup.
    const [order] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.id, orderId), eq(valoOrders.workspaceId, actor.workspaceId)))
      .for("update");
    if (!order) throw new ValoProblem(404, "Order not found.");
    await authorizeWorkspaceWrite(tx, actor);
    const [row] = await tx
      .select()
      .from(valoPaymentDisputes)
      .where(and(eq(valoPaymentDisputes.id, input.disputeId), eq(valoPaymentDisputes.orderId, orderId)));
    if (!row) throw new ValoProblem(404, "Dispute not found.");
    const [existing] = await tx
      .select()
      .from(valoDisputeInformation)
      .where(
        and(
          eq(valoDisputeInformation.workspaceId, actor.workspaceId),
          eq(valoDisputeInformation.requestKey, input.requestKey),
        ),
      );
    if (existing) {
      if (existing.disputeId !== row.id || digest(existing.information) !== digest(information))
        throw new ValoProblem(409, "That request key already identifies a different saved statement.");
      return;
    }
    await limitWorkspaceWrite(tx, actor, "support");
    await tx.insert(valoDisputeInformation).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      orderId,
      disputeId: row.id,
      actorId: actor.identityId,
      requestKey: input.requestKey,
      // Built above from present values only, so no field is undefined; Zod's type allows it.
      information: information as Record<string, string>,
      consentVersion: input.consentVersion,
    });
  });
  return orderDisputeInformation(actor, orderId);
}
