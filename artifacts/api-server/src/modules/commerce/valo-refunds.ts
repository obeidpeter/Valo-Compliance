import { activeStaffAssignment, assertStaffAssignmentCurrent } from "../staff";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  valoOrders,
  valoRefundRequests,
  valoRefundTransitions,
  valoEntitlements,
  valoPurchaseOutbox,
  valoStaffAssignments,
  valoStaffAccessAudit,
  valoPaymentDisputes,
} from "@workspace/db";
import { RequestCommerceRefundBody, DecideFinanceRefundBody } from "@workspace/api-zod";
import { authorizeWorkspaceWrite, type WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";
import { consumeQuota, quotaLimit, quotaSubjectHash } from "../../lib/valo-quota";
import {
  refundProvider,
  assertRefundMatch,
  refundBalance,
  TEST_REFUND_POLICY,
  TEST_REFUND_POLICY_VERSION,
  type RefundProvider,
} from "./valo-refund-provider";
import { setting } from "../../platform/settings";
import { singleRow } from "../../platform/rows";
import { queueMessage } from "../messages";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Refund = typeof valoRefundRequests.$inferSelect;
export type FinanceActor = { identityId: string; recentMfa: boolean; verifiedAt: number };
function freshMfa(actor: FinanceActor) {
  if (
    !actor.recentMfa ||
    !Number.isFinite(actor.verifiedAt) ||
    actor.verifiedAt > Date.now() + 1000 ||
    Date.now() - actor.verifiedAt > 300000
  )
    throw new ValoProblem(403, "Fresh multi-factor verification is required.");
}
/** Unlocked preflight conceals resource existence without pinning a role while
 * waiting on an order. The write transaction rechecks after the resource lock. */
export async function assertFinanceActor(actor: FinanceActor) {
  freshMfa(actor);
  const [row] = await db
    .select({ id: valoStaffAssignments.id })
    .from(valoStaffAssignments)
    .where(
      and(
        eq(valoStaffAssignments.identityId, actor.identityId),
        eq(valoStaffAssignments.role, "finance"),
        activeStaffAssignment(),
      ),
    );
  if (!row) throw new ValoProblem(403, "Active finance permission is required.");
}
export function refundView(row: Refund) {
  return {
    id: row.id,
    orderId: row.orderId,
    amountKobo: row.amountKobo,
    status: row.status,
    reference: row.reference,
    reason: row.reason,
    decisionReason: row.decisionReason,
    policyVersion: row.policyVersion,
    version: row.version,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
    checkedAt: row.checkedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    failure: row.failure,
  };
}
/** Checks the actor's live finance role and records the access: why, and to what (ADM-009). */
export async function requireFinance(tx: Tx, actor: FinanceActor, reason: string, object: string) {
  const [row] = await tx
    .select()
    .from(valoStaffAssignments)
    .where(
      and(
        eq(valoStaffAssignments.identityId, actor.identityId),
        eq(valoStaffAssignments.role, "finance"),
        activeStaffAssignment(),
      ),
    )
    .for("share");
  if (!row) throw new ValoProblem(403, "Active finance permission is required.");
  await assertStaffAssignmentCurrent(tx, row.id);
  freshMfa(actor);
  await tx.insert(valoStaffAccessAudit).values({
    id: randomUUID(),
    assignmentId: row.id,
    actorId: actor.identityId,
    area: "finance",
    object,
    reason,
  });
}
async function orderLock(tx: Tx, id: string, workspaceId?: string) {
  const [row] = await tx
    .select()
    .from(valoOrders)
    .where(and(eq(valoOrders.id, id), ...(workspaceId ? [eq(valoOrders.workspaceId, workspaceId)] : [])))
    .for("update");
  if (!row) throw new ValoProblem(404, "Order not found.");
  return row;
}
async function refundLock(tx: Tx, id: string) {
  // Discover only the financial order ID, then follow the common order->refund
  // locking order used by customer writes, authorisation and worker completion.
  const [link] = await tx
    .select({ orderId: valoRefundRequests.orderId })
    .from(valoRefundRequests)
    .where(eq(valoRefundRequests.id, id));
  if (!link) throw new ValoProblem(404, "Refund not found.");
  const order = await orderLock(tx, link.orderId);
  const [row] = await tx.select().from(valoRefundRequests).where(eq(valoRefundRequests.id, id)).for("update");
  if (!row) throw new ValoProblem(404, "Refund not found.");
  return { row, order };
}
async function transition(tx: Tx, r: Refund, actorId: string, action: string, reason: string) {
  await tx.insert(valoRefundTransitions).values({
    id: randomUUID(),
    workspaceId: r.workspaceId,
    orderId: r.orderId,
    refundId: r.id,
    actorId,
    action,
    reason,
  });
}
async function openDispute(tx: Tx, orderId: string) {
  const rows = await tx.select().from(valoPaymentDisputes).where(eq(valoPaymentDisputes.orderId, orderId));
  // Archived/declined is not documented proof of final bank disposition. Hold
  // competing refunds until a separate supported financial reconciliation can
  // establish the balance; never treat terminal labels as a merchant victory.
  return rows.length > 0;
}
export async function requestOrderRefund(actor: WorkspaceActor, id: string, raw: unknown) {
  const input = RequestCommerceRefundBody.strict().parse(raw);
  return db.transaction(async (tx) => {
    const order = await orderLock(tx, id, actor.workspaceId);
    await authorizeWorkspaceWrite(tx, actor);
    const [old] = await tx
      .select()
      .from(valoRefundRequests)
      .where(
        and(
          eq(valoRefundRequests.workspaceId, actor.workspaceId),
          eq(valoRefundRequests.requestKey, input.requestKey),
        ),
      );
    if (old) {
      if (
        old.orderId !== id ||
        old.amountKobo !== input.amountKobo ||
        old.reason !== input.reason ||
        old.policyVersion !== input.acceptedPolicyVersion
      )
        throw new ValoProblem(
          409,
          "This refund request key belongs to different details. The saved request is unchanged.",
        );
      return { reference: old.id, status: old.status };
    }
    const subject = quotaSubjectHash(setting("SESSION_SECRET"), "user", actor.identityId);
    for (const [bucket, window] of [
      ["refund-create", "minute"],
      ["refund-create-day", "day"],
    ] as const) {
      const q = await consumeQuota(bucket, subject, quotaLimit(bucket), window, tx);
      if (!q.allowed)
        throw new ValoProblem(
          429,
          "Refund request limit reached; saved requests and drafts are unchanged.",
          undefined,
          q.retryAfter,
        );
    }
    if (order.status !== "verified_success" || !order.providerTransactionId)
      throw new ValoProblem(409, "A verified successful purchase is required.");
    if (await openDispute(tx, id))
      throw new ValoProblem(409, "This payment has a dispute. Finance must reconcile it before any refund.");
    const all = await tx.select().from(valoRefundRequests).where(eq(valoRefundRequests.orderId, id));
    if (input.amountKobo > refundBalance(order.amountKobo, all).refundableKobo)
      throw new ValoProblem(
        409,
        "The amount exceeds the unreserved purchase balance. Pending and unknown refunds remain reserved.",
      );
    const refundId = randomUUID();
    const row = singleRow(
      await tx
        .insert(valoRefundRequests)
        .values({
          id: refundId,
          workspaceId: actor.workspaceId,
          orderId: id,
          reason: input.reason,
          amountKobo: input.amountKobo,
          requestKey: input.requestKey,
          reference: `vr-test-${refundId}`,
          policyVersion: TEST_REFUND_POLICY_VERSION,
        })
        .returning(),
    );
    await transition(
      tx,
      row,
      actor.identityId,
      "requested",
      "Customer accepted " + TEST_REFUND_POLICY_VERSION,
    );
    return { reference: row.id, status: row.status };
  });
}
export async function financeRefunds(actor: FinanceActor) {
  return db.transaction(async (tx) => {
    await requireFinance(tx, actor, "Read refund and dispute queue; no private document bodies.", "refunds");
    return {
      refunds: (
        await tx.select().from(valoRefundRequests).orderBy(desc(valoRefundRequests.createdAt)).limit(100)
      ).map(refundView),
      disputes: await tx
        .select()
        .from(valoPaymentDisputes)
        .orderBy(desc(valoPaymentDisputes.checkedAt))
        .limit(100),
      policy: TEST_REFUND_POLICY,
    };
  });
}
export async function decideRefund(actor: FinanceActor, id: string, raw: unknown) {
  const input = DecideFinanceRefundBody.strict().parse(raw);
  return db.transaction(async (tx) => {
    const { row, order } = await refundLock(tx, id);
    await requireFinance(tx, actor, `Refund ${id}: ${input.decision}; ${input.reason}`, `refund:${id}`);
    if (row.version !== input.expectedVersion)
      throw new ValoProblem(409, "Refund changed. Refresh before making a decision.");
    if (row.status !== "requested")
      throw new ValoProblem(409, "Only an undecided request can be approved or rejected.");
    if (input.decision === "approve") {
      if (!row.amountKobo || row.policyVersion !== TEST_REFUND_POLICY_VERSION)
        throw new ValoProblem(
          409,
          "Legacy amount or policy is unconfirmed. Reject with a reason and request an explicit replacement.",
        );
      if (
        order.status !== "verified_success" ||
        !order.providerTransactionId ||
        (await openDispute(tx, order.id))
      )
        throw new ValoProblem(409, "The payment or dispute requires reconciliation before authorisation.");
      const rows = await tx.select().from(valoRefundRequests).where(eq(valoRefundRequests.orderId, order.id));
      if (
        row.amountKobo >
        refundBalance(
          order.amountKobo,
          rows.filter((r) => r.id !== id),
        ).refundableKobo
      )
        throw new ValoProblem(409, "Cumulative refunds would exceed the payment.");
    }
    const status = input.decision === "approve" ? "approved" : "rejected";
    const result = singleRow(
      await tx
        .update(valoRefundRequests)
        .set({
          status,
          decisionReason: input.reason,
          authorisedBy: actor.identityId,
          authorisedAt: new Date(),
          version: row.version + 1,
        })
        .where(eq(valoRefundRequests.id, id))
        .returning(),
    );
    await transition(tx, result, actor.identityId, status, input.reason);
    return refundView(result);
  });
}
const workerStates = ["approved", "submitting", "unknown", "pending", "processing", "needs_attention"];
/** Only approved persisted requests reach this service. Controlled adapters are
 * restricted to explicitly owned synthetic development fixtures, never HTTP. */
export async function processRefund(
  id: string,
  provider: RefundProvider = refundProvider,
  lookupOnly = false,
) {
  if (!provider.configured()) return;
  const claim = await db.transaction(async (tx) => {
    const { row, order } = await refundLock(tx, id);
    if (
      provider !== refundProvider &&
      (setting("NODE_ENV") !== "development" ||
        setting("REPLIT_DEPLOYMENT") ||
        setting("VALO_RUN_REFUND_TESTS") !== "synthetic-development-only" ||
        !order.requestedBy.startsWith("synthetic-refund-"))
    )
      throw new ValoProblem(403, "Controlled adapters require owned synthetic development orders.");
    const terminal = lookupOnly && ["processed", "failed"].includes(row.status);
    if (
      (!terminal && !workerStates.includes(row.status)) ||
      (row.leaseUntil && +row.leaseUntil > Date.now()) ||
      (row.nextAttemptAt && +row.nextAttemptAt > Date.now())
    )
      return;
    if (!row.amountKobo || !row.authorisedBy || !row.authorisedAt)
      throw new ValoProblem(409, "A durable finance authorisation is required.");
    const others = await tx.select().from(valoRefundRequests).where(eq(valoRefundRequests.orderId, order.id));
    const unsafe = (await openDispute(tx, order.id))
      ? "DISPUTE_REQUIRES_FINANCE"
      : order.status !== "verified_success"
        ? "PAYMENT_STATE_CHANGED"
        : row.amountKobo >
            refundBalance(
              order.amountKobo,
              others.filter((r) => r.id !== row.id),
            ).refundableKobo
          ? "REFUND_BALANCE_CHANGED"
          : null;
    if (unsafe && row.status === "approved" && !row.providerId) {
      await tx
        .update(valoRefundRequests)
        .set({ status: "needs_review", failure: unsafe, version: row.version + 1 })
        .where(eq(valoRefundRequests.id, id));
      await transition(
        tx,
        row,
        "service:refund-worker",
        "held",
        "Payment, dispute or cumulative balance changed before dispatch.",
      );
      return;
    }
    if (row.attempts >= 5 && !terminal) {
      await tx
        .update(valoRefundRequests)
        .set({
          status: "needs_review",
          failure: "RETRY_LIMIT_REACHED",
          leaseToken: null,
          leaseUntil: null,
          version: row.version + 1,
        })
        .where(eq(valoRefundRequests.id, id));
      await transition(
        tx,
        row,
        "service:refund-worker",
        "held",
        "Five provider attempts exhausted; uncertain funds remain reserved.",
      );
      return;
    }
    const token = randomUUID();
    await tx
      .update(valoRefundRequests)
      .set({
        status: row.status === "approved" && !lookupOnly ? "submitting" : row.status,
        attempts: Math.min(5, row.attempts + 1),
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 45000),
        version: row.version + 1,
      })
      .where(eq(valoRefundRequests.id, id));
    await transition(
      tx,
      row,
      "service:refund-worker",
      "attempt",
      "Committed fenced attempt before provider I/O; stable reference retained.",
    );
    return { row, order, token, lookupOnly: lookupOnly || Boolean(unsafe) };
  });
  if (!claim) return;
  try {
    let observation = await provider.find(claim.row.reference);
    if (!observation) {
      if (claim.lookupOnly)
        throw new ValoProblem(
          409,
          "Provider refund not found during read-only or safety-restricted reconciliation.",
        );
      if (claim.row.providerId)
        throw new ValoProblem(409, "Previously observed refund is missing at the provider.");
      observation = await provider.create({
        reference: claim.row.reference,
        transaction: claim.order.providerTransactionId!,
        amount: claim.row.amountKobo!,
        currency: "NGN",
      });
    }
    const verified = assertRefundMatch(claim.row, claim.order.providerTransactionId!, observation);
    await db.transaction(async (tx) => {
      const { row, order } = await refundLock(tx, id);
      if (row.leaseToken !== claim.token) return;
      if (row.providerId && row.providerId !== verified.id)
        throw new ValoProblem(409, "Provider refund ID changed.");
      if (row.completedAt && verified.status !== "processed") {
        await tx
          .update(valoRefundRequests)
          .set({
            checkedAt: new Date(),
            failure: "LATE_PROVIDER_STATE_IGNORED",
            leaseToken: null,
            leaseUntil: null,
            nextAttemptAt: null,
            version: row.version + 1,
          })
          .where(eq(valoRefundRequests.id, id));
        await transition(
          tx,
          row,
          "service:refund-verifier",
          "late_state_ignored",
          "A later response cannot erase previously verified processing.",
        );
        return;
      }
      const status = verified.status.replace("-", "_");
      const result = singleRow(
        await tx
          .update(valoRefundRequests)
          .set({
            status,
            providerId: verified.id,
            checkedAt: new Date(),
            completedAt: status === "processed" ? new Date() : row.completedAt,
            failure: null,
            leaseToken: null,
            leaseUntil: null,
            nextAttemptAt: new Date(Date.now() + 60000),
            version: row.version + 1,
          })
          .where(eq(valoRefundRequests.id, id))
          .returning(),
      );
      await transition(
        tx,
        result,
        "service:refund-verifier",
        status,
        "Exact test domain, transaction, amount, currency and reference verified server-side.",
      );
      if (status === "processed") {
        const all = await tx
          .select()
          .from(valoRefundRequests)
          .where(eq(valoRefundRequests.orderId, order.id));
        const total = refundBalance(order.amountKobo, all).refundedKobo;
        if (total >= order.amountKobo)
          await tx
            .update(valoEntitlements)
            .set({ status: "suspended" })
            .where(eq(valoEntitlements.orderId, order.id));
        if (total > order.amountKobo) {
          await tx.update(valoOrders).set({ status: "needs_review" }).where(eq(valoOrders.id, order.id));
          await transition(
            tx,
            result,
            "service:refund-verifier",
            "over_refund_detected",
            "Contradictory provider history exceeds the original payment; further collection/refunds require finance.",
          );
        }
        await tx
          .insert(valoPurchaseOutbox)
          .values({
            id: randomUUID(),
            workspaceId: order.workspaceId,
            orderId: order.id,
            kind: `refund_processed:${row.id}`,
          })
          .onConflictDoNothing();
        // The refund notice, to whoever placed the order, owed only once the provider confirmed the refund
        // (docs/architecture/messages.md, part 5).
        await queueMessage(tx, {
          workspaceId: order.workspaceId,
          kind: "refund_processed",
          recipientIdentityId: order.requestedBy,
          subjectId: row.id,
        });
      }
    });
  } catch (error) {
    await db.transaction(async (tx) => {
      const { row } = await refundLock(tx, id);
      if (row.leaseToken !== claim.token) return;
      const mismatch = (error instanceof ValoProblem && error.status === 409) || error instanceof z.ZodError;
      await tx
        .update(valoRefundRequests)
        .set({
          status: mismatch ? "needs_review" : "unknown",
          failure: mismatch ? "PROVIDER_MISMATCH" : "PROVIDER_RESPONSE_UNKNOWN",
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + 60000),
          version: row.version + 1,
        })
        .where(eq(valoRefundRequests.id, id));
      await transition(
        tx,
        row,
        "service:refund-worker",
        "held",
        mismatch
          ? "Provider observation failed exact matching."
          : "Provider response unknown; lookup the same reference before any repeat.",
      );
    });
  }
}
export async function processRefundQueue() {
  if (!refundProvider.configured()) return;
  const rows = await db
    .select({ id: valoRefundRequests.id })
    .from(valoRefundRequests)
    .where(
      and(
        inArray(valoRefundRequests.status, workerStates),
        sql`(${valoRefundRequests.nextAttemptAt} is null or ${valoRefundRequests.nextAttemptAt} <= now())`,
      ),
    )
    .limit(20);
  for (const row of rows) await processRefund(row.id);
}
export async function handleRefundEvent(reference: string) {
  if (!refundProvider.configured()) return false;
  const [row] = await db.select().from(valoRefundRequests).where(eq(valoRefundRequests.reference, reference));
  if (!row) throw new ValoProblem(409, "Unmatched refund event requires finance reconciliation.");
  // Ignore the event's claimed status/amount. Poll the canonical provider record.
  await db.update(valoRefundRequests).set({ nextAttemptAt: null }).where(eq(valoRefundRequests.id, row.id));
  await processRefund(row.id, refundProvider, true);
  return true;
}
export async function reconcileFinanceRefund(actor: FinanceActor, id: string) {
  await db.transaction(async (tx) => {
    const { row } = await refundLock(tx, id);
    await requireFinance(tx, actor, `Reconcile refund ${id} by its original reference.`, `refund:${id}`);
    if (!refundProvider.configured())
      throw new ValoProblem(
        503,
        "Test merchant and explicit test-refund enablement are required. No provider request was made.",
      );
    if (row.status === "needs_review" && row.authorisedBy && row.amountKobo) {
      await tx
        .update(valoRefundRequests)
        .set({ status: "unknown", attempts: 0, nextAttemptAt: null, failure: null, version: row.version + 1 })
        .where(eq(valoRefundRequests.id, id));
      await transition(
        tx,
        row,
        actor.identityId,
        "reconciliation_authorised",
        "Fresh finance MFA authorises bounded lookup/retry using the same refund reference.",
      );
    } else if (workerStates.includes(row.status))
      await tx.update(valoRefundRequests).set({ nextAttemptAt: null }).where(eq(valoRefundRequests.id, id));
  });
  await processRefund(id, refundProvider, true);
  return db.transaction(async (tx) => {
    const { row } = await refundLock(tx, id);
    await requireFinance(tx, actor, `Read reconciliation result ${id}.`, `refund:${id}`);
    return refundView(row);
  });
}
