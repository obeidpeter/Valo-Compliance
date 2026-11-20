import { randomUUID, createHash } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  valoOrders,
  valoPaymentDisputes,
  valoDisputeInformation,
  valoDisputeActions,
  valoDisputeTransitions,
  valoRefundRequests,
  valoPrivacyTombstones,
  valoEntitlements,
} from "@workspace/db";
import {
  SaveOrderDisputeInformationBody,
  PrepareFinanceDisputeBody,
  ControlFinanceDisputeBody,
  HoldFinanceDisputeBody,
  LinkFinanceDisputeBody,
} from "@workspace/api-zod";
import { authorizeWorkspaceWrite, limitWorkspaceWrite, type WorkspaceActor } from "../../lib/valo-store";
import { assertFinanceActor, requireFinance, type FinanceActor } from "./valo-refunds";
import { ValoProblem } from "../../platform/valo-problem";
import {
  disputeInformation,
  disputeTransport,
  matchDispute,
  resolutionPayload,
  DisputeMutationNotSent,
  type DisputeTransport,
  type DisputeContext,
} from "./valo-dispute-provider";
import { storeVerifiedDispute, disputeSnapshotHash } from "./valo-payment-disputes";
import { assertRecoveryEffectsAllowed } from "../../platform/valo-recovery-effects";
import { renderDocument } from "../../lib/valo-render";
import { setting } from "../../platform/settings";
import { singleRow } from "../../platform/rows";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Action = typeof valoDisputeActions.$inferSelect;
type Order = typeof valoOrders.$inferSelect;
export const DISPUTE_POLICY =
  "test-dispute-v1: Customer statements and receipts are not independent delivery proof. Prepared, acknowledged and observed merchant decisions are not bank outcomes. Unknown attempts are never automatically re-sent. Pending refunds and merchant acceptances reserve their full amounts. Terminal observations alone do not change access; previous holds, refunds and reversals are not automatically undone. Customer drafts are never deleted. Financial evidence/history remain retained pending policy/hold review, not declared erased or removed from external processors.";
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sorted(x)]),
    );
  return v;
}
const digest = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(sorted(v)))
    .digest("hex");
async function locked(tx: Tx, id: string) {
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
async function source(
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
function context(order: Order, providerId: string): DisputeContext {
  if (!order.providerTransactionId || order.currency !== "NGN")
    throw new ValoProblem(409, "A verified test transaction is required.");
  return {
    providerId,
    transactionId: order.providerTransactionId,
    reference: order.reference,
    amountKobo: order.amountKobo,
  };
}
async function transition(tx: Tx, a: Action, actorId: string, status: string) {
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
function actionView(a: Action) {
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
async function detail(tx: Tx, id: string, enabled = false) {
  const { row, order } = await locked(tx, id);
  const actions = await tx
    .select()
    .from(valoDisputeActions)
    .where(eq(valoDisputeActions.disputeId, id))
    .orderBy(desc(valoDisputeActions.createdAt));
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
      .where(eq(valoDisputeInformation.disputeId, id)),
    history: await tx
      .select()
      .from(valoDisputeTransitions)
      .where(eq(valoDisputeTransitions.orderId, order.id)),
    executionEnabled: enabled,
    policy: DISPUTE_POLICY,
  };
}
export async function financeDispute(actor: FinanceActor, id: string) {
  await assertFinanceActor(actor);
  return db.transaction(async (tx) => {
    await locked(tx, id);
    await requireFinance(tx, actor, "Inspect scoped dispute and customer-consented financial evidence.");
    return detail(tx, id, disputeTransport.configured());
  });
}
export async function orderDisputeInformation(actor: WorkspaceActor, orderId: string) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.id, orderId), eq(valoOrders.workspaceId, actor.workspaceId)))
      .for("share");
    if (!order) throw new ValoProblem(404, "Order not found.");
    await authorizeWorkspaceWrite(tx, actor);
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
export async function prepareDisputeAction(actor: FinanceActor, id: string, raw: unknown) {
  const input = PrepareFinanceDisputeBody.strict().parse(raw);
  await assertFinanceActor(actor);
  return db.transaction(async (tx) => {
    const { row, order } = await locked(tx, id);
    await requireFinance(tx, actor, "Authorize prepared dispute intent; no provider request.");
    const existing = await tx.select().from(valoDisputeActions).where(eq(valoDisputeActions.disputeId, id));
    const payload: Record<string, string | number> = {
      message: input.message,
      requestHash: digest(input),
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.amountKobo !== undefined ? { amountKobo: input.amountKobo } : {}),
    };
    const duplicate = existing.find((a) => a.requestKey === input.requestKey);
    if (duplicate) {
      if (
        duplicate.kind !== input.kind ||
        duplicate.informationId !== (input.informationId ?? null) ||
        duplicate.payload.requestHash !== digest(input)
      )
        throw new ValoProblem(409, "The immutable prepared intent differs from these details.");
      return detail(tx, id, disputeTransport.configured());
    }
    if (row.held || row.status !== "awaiting-merchant-feedback")
      throw new ValoProblem(409, "Dispute is held or is not awaiting merchant feedback.");
    if (existing.some((a) => ["dispatching", "unknown"].includes(a.status)))
      throw new ValoProblem(409, "Reconcile the earlier uncertain action before preparing another.");
    if (existing.some((a) => a.kind === input.kind && a.status !== "cancelled"))
      throw new ValoProblem(
        409,
        "This operation already has a retained intent. Inspect/reconcile it; do not create another.",
      );
    if (order.status !== "verified_success")
      throw new ValoProblem(409, "The payment is no longer a verified successful payment.");
    if (
      input.kind !== "merchant_decision" &&
      (input.resolution !== undefined || input.amountKobo !== undefined)
    )
      throw new ValoProblem(422, "Financial decision fields do not belong on evidence operations.");
    const s = await source(tx, order, id, input.informationId ?? null);
    if (input.kind === "submit_evidence" && !s.record)
      throw new ValoProblem(422, "Select actual consented customer information.");
    if (input.kind === "merchant_decision") {
      if (!input.resolution || input.amountKobo === undefined)
        throw new ValoProblem(422, "Specify the merchant decision and integer kobo amount.");
      const upload = existing.find((a) => a.kind === "upload_receipt" && a.status === "acknowledged");
      const evidence = existing.find((a) => a.kind === "submit_evidence" && a.status === "acknowledged");
      if (!["general", "fraud"].includes(row.category ?? ""))
        throw new ValoProblem(
          422,
          "Provider claim classification needs verified refresh before a merchant decision can be prepared.",
        );
      if (row.category === "fraud" && input.resolution === "declined" && !evidence)
        throw new ValoProblem(
          422,
          "Fraud declines require acknowledged structured evidence before a decision can be prepared.",
        );
      if (upload?.result?.filename) payload.uploadedFilename = upload.result.filename;
      if (evidence?.result?.evidenceId) payload.evidenceId = evidence.result.evidenceId;
      resolutionPayload(
        {
          resolution: input.resolution,
          amountKobo: input.amountKobo,
          message: input.message,
          uploadedFilename: upload?.result?.filename,
          evidenceId: evidence?.result?.evidenceId,
        },
        order.amountKobo,
      );
      const refunds = await tx
        .select()
        .from(valoRefundRequests)
        .where(eq(valoRefundRequests.orderId, order.id));
      const other = await tx
        .select()
        .from(valoDisputeActions)
        .where(eq(valoDisputeActions.orderId, order.id));
      const reserved =
        refunds
          .filter((r) => !(["rejected", "failed"].includes(r.status) && !r.completedAt))
          .reduce((sum, r) => sum + BigInt(r.amountKobo ?? order.amountKobo), 0n) +
        other
          .filter((a) => a.kind === "merchant_decision" && a.status !== "cancelled")
          .reduce((sum, a) => sum + BigInt(a.payload.amountKobo ?? 0), 0n);
      if (BigInt(input.amountKobo) + reserved > BigInt(order.amountKobo))
        throw new ValoProblem(409, "Refunds and other retained decisions reserve this balance.");
    }
    const a = singleRow(
      await tx
        .insert(valoDisputeActions)
        .values({
          id: randomUUID(),
          workspaceId: row.workspaceId,
          orderId: order.id,
          disputeId: id,
          requestKey: input.requestKey,
          kind: input.kind,
          payload,
          informationId: input.informationId ?? null,
          sourceHash: s.hash,
          policyVersion: "test-dispute-v1",
          authorisedBy: actor.identityId,
        })
        .returning(),
    );
    await transition(tx, a, actor.identityId, "prepared");
    return detail(tx, id, disputeTransport.configured());
  });
}
export async function renderPurchaseReceipt(order: Order) {
  const amount = BigInt(order.amountKobo),
    text = [
      "Order reference: " + order.reference,
      "Provider test transaction: " + order.providerTransactionId,
      "Original purchase: " + order.line.title,
      "Original amount NGN " + amount / 100n + "." + (amount % 100n).toString().padStart(2, "0"),
      "Licence version: " + order.line.licenceVersion,
      order.line.licenceText,
      "Order created at (not a delivery date): " + order.createdAt.toISOString(),
      "No customer name, delivery date or proof of fulfilment is inferred.",
    ];
  return renderDocument(
    {
      title: "Valo purchase receipt — development",
      content: {
        fields: {
          issuerName: "Valo",
          recipientName: "",
          documentNumber: order.reference,
          issueDate: "",
          dueDate: "",
          notes: "Original purchase record; later statuses are separate.",
        },
        blocks: text.map((s, i) => ({ id: "receipt-" + i, type: "paragraph", text: s, rows: [] })),
        selectedClauses: [],
        formatting: { font: "sans", accent: "forest" },
      },
    },
    "pdf",
    1,
    "purchase_receipt",
  );
}
/** No scheduler invokes this method. Each mutation is a separately authorised,
 * single-attempt intent; a crash or unknown response requires GET reconciliation. */
export async function controlDisputeAction(
  actor: FinanceActor,
  id: string,
  operation: "execute" | "reconcile" | "cancel",
  raw: unknown,
  provider: DisputeTransport = disputeTransport,
  receipt = renderPurchaseReceipt,
) {
  const input = ControlFinanceDisputeBody.strict().parse(raw);
  await assertFinanceActor(actor);
  if (operation === "execute" && input.acknowledgement !== true)
    throw new ValoProblem(422, "Explicit acknowledgement of the saved action is required before dispatch.");
  const [a0] = await db.select().from(valoDisputeActions).where(eq(valoDisputeActions.id, id));
  if (!a0) throw new ValoProblem(404, "Dispute intent not found.");
  const start = await db.transaction(async (tx) => {
    const { row, order } = await locked(tx, a0.disputeId);
    await requireFinance(tx, actor, "Dispute intent " + operation + "; strict MFA.");
    const a = singleRow(
      await tx.select().from(valoDisputeActions).where(eq(valoDisputeActions.id, id)).for("update"),
    );
    if (
      provider !== disputeTransport &&
      (setting("NODE_ENV") !== "development" ||
        setting("REPLIT_DEPLOYMENT") ||
        setting("VALO_RUN_DISPUTE_TESTS") !== "synthetic-development-only" ||
        !order.requestedBy.startsWith("synthetic-dispute-"))
    )
      throw new ValoProblem(403, "Controlled transports require an owned synthetic development fixture.");
    if (operation === "execute" && a.status !== "prepared") return { done: true as const, disputeId: row.id };
    if (a.version !== input.expectedVersion)
      throw new ValoProblem(409, "Intent changed. Reload its authoritative version.");
    if (operation === "cancel") {
      if (a.attempts !== 0 || a.status !== "prepared")
        throw new ValoProblem(409, "A sent or unknown mutation cannot be cancelled locally.");
      await tx
        .update(valoDisputeActions)
        .set({ status: "cancelled", version: a.version + 1, updatedAt: new Date() })
        .where(eq(valoDisputeActions.id, id));
      await transition(tx, a, actor.identityId, "cancelled");
      return { done: true as const, disputeId: row.id };
    }
    assertRecoveryEffectsAllowed();
    if (!provider.configured())
      throw new ValoProblem(
        503,
        "Merchant test execution is disabled or unconfigured. Prepared work is saved; nothing was sent.",
      );
    const s = await source(tx, order, row.id, a.informationId, operation === "reconcile");
    if (a.sourceHash !== s.hash || a.policyVersion !== "test-dispute-v1")
      throw new ValoProblem(409, "Source or policy changed. The old intent cannot dispatch.");
    const others = await tx.select().from(valoDisputeActions).where(eq(valoDisputeActions.disputeId, row.id));
    let claimToken = a.claimToken;
    if (operation === "execute") {
      if (row.held || row.status !== "awaiting-merchant-feedback")
        throw new ValoProblem(409, "Dispute is held or no longer awaiting merchant feedback.");
      if (others.some((x) => x.id !== a.id && ["dispatching", "unknown"].includes(x.status)))
        throw new ValoProblem(409, "Reconcile earlier uncertain work before sending another action.");
      if (a.attempts !== 0) throw new ValoProblem(409, "A retained attempt cannot be re-sent.");
      if (order.status !== "verified_success")
        throw new ValoProblem(409, "The payment status changed; no mutation was sent.");
      const refunds = await tx
        .select()
        .from(valoRefundRequests)
        .where(eq(valoRefundRequests.orderId, order.id));
      if (refunds.some((r) => !["failed", "rejected"].includes(r.status) || !!r.completedAt))
        throw new ValoProblem(409, "A competing refund requires finance reconciliation first.");
      claimToken = randomUUID();
      await tx
        .update(valoDisputeActions)
        .set({
          status: "dispatching",
          version: a.version + 1,
          attempts: 1,
          claimToken,
          leaseUntil: new Date(Date.now() + 120000),
          updatedAt: new Date(),
        })
        .where(eq(valoDisputeActions.id, id));
      await transition(tx, a, actor.identityId, "dispatching");
    }
    if (
      operation === "reconcile" &&
      a.status === "dispatching" &&
      Date.now() - a.updatedAt.getTime() < 120000
    )
      throw new ValoProblem(
        409,
        "The current attempt is still active. Inspect its result or reconcile after two minutes if its process stopped.",
      );
    return {
      done: false as const,
      a,
      order,
      row,
      claimToken,
      information: s.record?.information,
      upload: typeof a.payload.uploadedFilename === "string" ? a.payload.uploadedFilename : undefined,
      evidence: typeof a.payload.evidenceId === "string" ? a.payload.evidenceId : undefined,
    };
  });
  if (start.done) return financeDispute(actor, start.disputeId);
  const c = context(start.order, start.row.providerId);
  const beforeSend = async () =>
    db.transaction(async (tx) => {
      const { row, order } = await locked(tx, start.row.id);
      await requireFinance(
        tx,
        actor,
        "Recheck live finance, dispute hold and source after provider lookup, immediately before mutation.",
      );
      assertRecoveryEffectsAllowed();
      if (!provider.configured())
        throw new ValoProblem(503, "Dispute execution disabled during preparation.");
      const a = singleRow(
        await tx.select().from(valoDisputeActions).where(eq(valoDisputeActions.id, id)).for("update"),
      );
      if (
        a.status !== "dispatching" ||
        a.claimToken !== start.claimToken ||
        a.version !== start.a.version + 1 ||
        !a.leaseUntil ||
        a.leaseUntil.getTime() <= Date.now()
      )
        throw new ValoProblem(409, "Dispatch lease expired or was superseded. Reconcile without resending.");
      if (
        row.held ||
        row.status !== "awaiting-merchant-feedback" ||
        order.status !== "verified_success" ||
        digest(context(order, row.providerId)) !== digest(c)
      )
        throw new ValoProblem(409, "The order, canonical state or hold changed before dispatch.");
      const current = await source(tx, order, row.id, start.a.informationId);
      if (current.hash !== start.a.sourceHash)
        throw new ValoProblem(409, "Evidence source changed before dispatch.");
      const refunds = await tx
        .select()
        .from(valoRefundRequests)
        .where(eq(valoRefundRequests.orderId, order.id));
      if (refunds.some((r) => !["failed", "rejected"].includes(r.status) || !!r.completedAt))
        throw new ValoProblem(409, "Competing refunds reserve this payment.");
      const actions = await tx
        .select()
        .from(valoDisputeActions)
        .where(eq(valoDisputeActions.orderId, order.id));
      if (actions.some((x) => x.id !== id && ["dispatching", "unknown"].includes(x.status)))
        throw new ValoProblem(409, "An uncertain action must be reconciled before further dispatch.");
      const reserved = actions
        .filter((x) => x.id !== id && x.kind === "merchant_decision" && x.status !== "cancelled")
        .reduce((sum, x) => sum + BigInt(x.payload.amountKobo ?? 0), 0n);
      if (
        start.a.kind === "merchant_decision" &&
        BigInt(start.a.payload.amountKobo ?? 0) + reserved > BigInt(order.amountKobo)
      )
        throw new ValoProblem(409, "Other dispute decisions reserve this balance.");
    });
  let result: Record<string, string> | null = null,
    status = start.a.status === "dispatching" ? "unknown" : start.a.status,
    failure: string | null = null,
    dispatched = false;
  try {
    if (operation === "reconcile") {
      const fetched = matchDispute(c, await provider.fetch(c)),
        stored = await storeVerifiedDispute(c.providerId, fetched);
      if (stored.snapshotHash !== disputeSnapshotHash(fetched)) throw Error("STALE_CANONICAL");
      if (
        start.a.kind === "merchant_decision" &&
        start.a.attempts > 0 &&
        fetched.status !== "awaiting-merchant-feedback" &&
        fetched.resolution === start.a.payload.resolution &&
        fetched.refund_amount === start.a.payload.amountKobo
      ) {
        status = "observed";
        result = {
          observation:
            "Matching merchant financial effect seen in canonical state; original transmission acknowledgement and final bank outcome are not inferred.",
          canonicalHash: disputeSnapshotHash(fetched),
          status: fetched.status,
          resolution: fetched.resolution ?? "",
          refundAmountKobo: String(fetched.refund_amount),
          providerUpdatedAt: fetched.updatedAt ?? "not supplied",
        };
      } else if (
        start.a.kind === "submit_evidence" &&
        start.a.attempts > 0 &&
        fetched.evidence &&
        typeof fetched.evidence === "object" &&
        start.information
      ) {
        const e = fetched.evidence as Record<string, unknown>;
        if (
          /^\d{1,40}$/.test(String(e.id)) &&
          String(e.dispute) === c.providerId &&
          Object.entries(start.information).every(([key, value]) => e[key] === value)
        ) {
          status = "acknowledged";
          result = { evidenceId: String(e.id) };
        } else failure = "CANONICAL_OUTCOME_UNRESOLVED";
      } else failure = "CANONICAL_OUTCOME_UNRESOLVED";
    } else {
      const bytes = start.a.kind === "upload_receipt" ? await receipt(start.order) : null;
      await db.transaction(async (tx) => {
        const { order: currentOrder } = await locked(tx, start.row.id);
        await requireFinance(tx, actor, "Recheck finance authority immediately before external dispatch.");
        if (currentOrder.status !== "verified_success")
          throw new ValoProblem(409, "The payment changed before dispatch.");
        const s = await source(tx, currentOrder, start.row.id, start.a.informationId);
        if (s.hash !== start.a.sourceHash) throw new ValoProblem(409, "Source changed before dispatch.");
        if (bytes) {
          await tx
            .update(valoDisputeActions)
            .set({ result: { attemptChecksum: createHash("sha256").update(bytes).digest("hex") } })
            .where(eq(valoDisputeActions.id, id));
          await transition(tx, start.a, "service:receipt-renderer", "receipt_rendered");
        }
      });
      dispatched = true;
      if (start.a.kind === "upload_receipt")
        result = await provider.upload(
          c,
          "valo-receipt-" + start.order.id + ".pdf",
          bytes!,
          async (proof) => {
            await beforeSend();
            await db.transaction(async (tx) => {
              const { order } = await locked(tx, start.row.id);
              await requireFinance(
                tx,
                actor,
                "Bind provider filename/checksum before receipt PUT; no signed URL retained.",
              );
              const current = await source(tx, order, start.row.id, start.a.informationId);
              if (current.hash !== start.a.sourceHash)
                throw new ValoProblem(409, "Receipt source changed before upload.");
              await tx
                .update(valoDisputeActions)
                .set({ result: { filename: proof.filename, attemptChecksum: proof.checksum } })
                .where(
                  and(
                    eq(valoDisputeActions.id, id),
                    eq(valoDisputeActions.claimToken, start.claimToken!),
                    eq(valoDisputeActions.status, "dispatching"),
                  ),
                );
              await transition(tx, start.a, "service:receipt-upload", "upload_planned");
            });
            await beforeSend();
          },
        );
      else if (start.a.kind === "submit_evidence")
        result = await provider.evidence(c, disputeInformation.parse(start.information), beforeSend);
      else
        await provider.resolve(
          c,
          {
            resolution: start.a.payload.resolution as "merchant-accepted" | "declined",
            amountKobo: Number(start.a.payload.amountKobo),
            message: String(start.a.payload.message),
            uploadedFilename: start.upload,
            evidenceId: start.evidence,
          },
          beforeSend,
        );
      status = "acknowledged";
    }
  } catch (error) {
    const notSent = !dispatched || error instanceof DisputeMutationNotSent;
    status =
      operation === "execute"
        ? notSent
          ? "cancelled"
          : "unknown"
        : start.a.status === "dispatching"
          ? "unknown"
          : start.a.status;
    failure =
      operation === "execute" && notSent
        ? dispatched
          ? "NO_MUTATION_DISPATCHED"
          : "NOT_DISPATCHED"
        : "PROVIDER_OUTCOME_UNCERTAIN";
  }
  await db.transaction(async (tx) => {
    await locked(tx, start.row.id);
    const current = singleRow(
      await tx.select().from(valoDisputeActions).where(eq(valoDisputeActions.id, id)).for("update"),
    );
    // A newer observed canonical outcome cannot be overwritten by a late callback.
    if (
      current.status === "observed" ||
      current.version !== (operation === "execute" ? start.a.version + 1 : start.a.version) ||
      (operation === "execute" && current.claimToken !== start.claimToken)
    )
      return;
    await tx
      .update(valoDisputeActions)
      .set({
        status,
        result: result ?? current.result,
        failure,
        claimToken: null,
        leaseUntil: null,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(valoDisputeActions.id, id));
    await transition(tx, current, "service:dispute-outcome", status);
  });
  return financeDispute(actor, start.row.id);
}

/** Separate staff hold controls never erase attempts or release liabilities. */
export async function holdFinanceDispute(actor: FinanceActor, id: string, raw: unknown) {
  const input = HoldFinanceDisputeBody.strict().parse(raw);
  await assertFinanceActor(actor);
  return db.transaction(async (tx) => {
    const { row, order } = await locked(tx, id);
    await requireFinance(tx, actor, "Dispute " + id + "; set hold=" + input.held + ": " + input.reason);
    if (row.controlVersion !== input.expectedVersion)
      throw new ValoProblem(409, "Dispute hold changed. Refresh first.");
    if (!input.held) await source(tx, order, id, null);
    await tx
      .update(valoPaymentDisputes)
      .set({ held: input.held, controlVersion: row.controlVersion + 1 })
      .where(eq(valoPaymentDisputes.id, id));
    return detail(tx, id, disputeTransport.configured());
  });
}
export async function linkFinanceDispute(
  actor: FinanceActor,
  raw: unknown,
  provider: DisputeTransport = disputeTransport,
) {
  const input = LinkFinanceDisputeBody.strict().parse(raw);
  await assertFinanceActor(actor);
  const order = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(valoOrders).where(eq(valoOrders.id, input.orderId)).for("update");
    if (!o) throw new ValoProblem(404, "Order not found.");
    await requireFinance(tx, actor, "Fetch a canonical test dispute for the exact selected order.");
    if (o.status !== "verified_success" && o.status !== "reversed")
      throw new ValoProblem(409, "A verified transaction binding is required.");
    return o;
  });
  if (
    provider !== disputeTransport &&
    (setting("NODE_ENV") !== "development" ||
      setting("REPLIT_DEPLOYMENT") ||
      setting("VALO_RUN_DISPUTE_TESTS") !== "synthetic-development-only" ||
      !order.requestedBy.startsWith("synthetic-dispute-"))
  )
    throw new ValoProblem(403, "Owned synthetic adapter required.");
  assertRecoveryEffectsAllowed();
  if (!provider.configured()) throw new ValoProblem(503, "Test dispute lookup is disabled.");
  const c = context(order, input.providerId),
    rawDispute = matchDispute(c, await provider.fetch(c));
  await assertFinanceActor(actor);
  const stored = await storeVerifiedDispute(input.providerId, rawDispute);
  return financeDispute(actor, stored.id);
}
/** Workers may fence expired attempts and fetch canonical state; they never
 * dispatch a mutation or manufacture a staff session. */
export async function reconcileDisputeActions(provider: DisputeTransport = disputeTransport) {
  const rows = await db
    .select()
    .from(valoDisputeActions)
    .where(
      sql`${valoDisputeActions.status}='dispatching' AND COALESCE(${valoDisputeActions.leaseUntil},${valoDisputeActions.updatedAt}+interval '2 minutes')<=now() OR ${valoDisputeActions.status}='unknown' AND ${valoDisputeActions.updatedAt}<now()-interval '1 hour'`,
    )
    .limit(10);
  for (const item of rows) {
    const saved = await db.transaction(async (tx) => {
      const { row, order } = await locked(tx, item.disputeId);
      const a = singleRow(
        await tx.select().from(valoDisputeActions).where(eq(valoDisputeActions.id, item.id)).for("update"),
      );
      if (a.status !== "dispatching" && a.status !== "unknown") return null;
      if (
        a.status === "dispatching" &&
        (a.leaseUntil ?? new Date(a.updatedAt.getTime() + 120000)).getTime() > Date.now()
      )
        return null;
      const n = singleRow(
        await tx
          .update(valoDisputeActions)
          .set({
            status: "unknown",
            claimToken: null,
            leaseUntil: null,
            version: a.version + 1,
            updatedAt: new Date(),
            failure: "ABANDONED_OR_UNCERTAIN_NO_AUTOMATIC_RESEND",
          })
          .where(eq(valoDisputeActions.id, a.id))
          .returning(),
      );
      await transition(tx, n, "service:dispute-recovery", "unknown");
      return { a: n, row, order };
    });
    if (!saved || !provider.configured()) continue;
    if (
      provider !== disputeTransport &&
      (setting("NODE_ENV") !== "development" ||
        setting("REPLIT_DEPLOYMENT") ||
        setting("VALO_RUN_DISPUTE_TESTS") !== "synthetic-development-only" ||
        !saved.order.requestedBy.startsWith("synthetic-dispute-"))
    )
      throw new ValoProblem(403, "Owned recovery adapter required.");
    try {
      assertRecoveryEffectsAllowed();
      const c = context(saved.order, saved.row.providerId),
        fetched = matchDispute(c, await provider.fetch(c)),
        stored = await storeVerifiedDispute(c.providerId, fetched);
      if (stored.snapshotHash !== disputeSnapshotHash(fetched)) continue;
      // Matching money effect is observable; it never proves the original response receipt.
      if (
        saved.a.kind !== "merchant_decision" ||
        fetched.status === "awaiting-merchant-feedback" ||
        fetched.resolution !== saved.a.payload.resolution ||
        fetched.refund_amount !== saved.a.payload.amountKobo
      )
        continue;
      await db.transaction(async (tx) => {
        await locked(tx, saved.row.id);
        const a = singleRow(
          await tx
            .select()
            .from(valoDisputeActions)
            .where(eq(valoDisputeActions.id, saved.a.id))
            .for("update"),
        );
        if (a.status !== "unknown" || a.version !== saved.a.version) return;
        const n = singleRow(
          await tx
            .update(valoDisputeActions)
            .set({
              status: "observed",
              version: a.version + 1,
              updatedAt: new Date(),
              failure: null,
              result: {
                observation:
                  "Matching canonical financial effect; original transmission receipt and bank outcome remain unproven.",
                canonicalHash: disputeSnapshotHash(fetched),
              },
            })
            .where(eq(valoDisputeActions.id, a.id))
            .returning(),
        );
        await transition(tx, n, "service:dispute-recovery", "observed");
      });
    } catch {
      /* Retain unknown, its reservation and its history. No mutation retry. */
    }
  }
}
