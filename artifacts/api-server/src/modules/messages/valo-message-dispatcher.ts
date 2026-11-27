import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  runInWorkspaceScope,
  valoMemberships,
  valoMessages,
  valoOrders,
  valoPrivacyTombstones,
  valoPurchaseOutbox,
  valoRefundRequests,
  valoSafetySwitches,
  type ValoMessage,
} from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { trustedSiteOrigin } from "../../lib/valo-site-origin";
import { environment } from "../../platform/settings";
import { configuredMessageSender, type MessageSender } from "./message-sender";
import { receiptMessage, refundMessage, type ComposedMessage } from "./message-text";
import { MESSAGE_ATTEMPT_LIMIT, messageRetryAt } from "./message-policy";
import { messagesReady } from "./valo-messages";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** How long an attempt holds its message, and how long a sender has to answer within it. */
const LEASE_MS = 30_000,
  SEND_TIMEOUT_MS = 18_000;
/** How long a message waits before it is looked at again when something stops it for now. */
const HOLD_MS = { paused: 5 * 60_000, noSender: 15 * 60_000 } as const;
/**
 * Only the payment provider's test mode can take a payment: the provider's contract accepts only a test key
 * (commerce's valo-paystack-contract.ts), and a live payment waits for the owner's approval. So every
 * purchase message says that no real money moved.
 */
const PAYMENTS_IN_TEST_MODE = true;

type Stop = { status: "held" | "cancelled"; reason: string; retryAt?: Date };

/** The provider idempotency key of a message: the same on every attempt, and naming nothing about it. */
const providerKey = (id: string) => `valo-message-v1-${sha256(id)}`;

/**
 * Everything that could stop a message now, read in the transaction that claims it, just before it is sent
 * (docs/architecture/messages.md, part 1): the pause, an erased workspace, a recipient who is no longer a
 * member, and a record that no longer owes the message. A message that may go is composed from its record as
 * the record is now.
 */
async function check(tx: Tx, row: ValoMessage, origin: string | null): Promise<Stop | ComposedMessage> {
  const [pause] = await tx
    .select({ enabled: valoSafetySwitches.enabled })
    .from(valoSafetySwitches)
    .where(eq(valoSafetySwitches.key, "messages"));
  if (pause && !pause.enabled) return { status: "held", reason: "MESSAGES_PAUSED" };
  const [erased] = await tx
    .select({ id: valoPrivacyTombstones.id })
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId, row.workspaceId))
    .limit(1);
  if (erased) return { status: "cancelled", reason: "WORKSPACE_ERASED" };
  const [member] = await tx
    .select({ active: valoMemberships.active })
    .from(valoMemberships)
    .where(
      and(
        eq(valoMemberships.workspaceId, row.workspaceId),
        eq(valoMemberships.identityId, row.recipientIdentityId),
      ),
    );
  if (member?.active !== "yes") return { status: "cancelled", reason: "RECIPIENT_NOT_A_MEMBER" };
  if (row.kind === "purchase_receipt") {
    const [order] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.workspaceId, row.workspaceId), eq(valoOrders.id, row.subjectId)));
    if (!order) return { status: "cancelled", reason: "RECORD_NOT_FOUND" };
    if (order.status !== "verified_success") return { status: "cancelled", reason: "ORDER_NOT_VERIFIED" };
    const [owed] = await tx
      .select({ status: valoPurchaseOutbox.status })
      .from(valoPurchaseOutbox)
      .where(
        and(
          eq(valoPurchaseOutbox.workspaceId, row.workspaceId),
          eq(valoPurchaseOutbox.orderId, order.id),
          eq(valoPurchaseOutbox.kind, "purchase_receipt"),
        ),
      );
    if (!owed || owed.status.startsWith("held_"))
      return { status: "cancelled", reason: "PURCHASE_MESSAGE_HELD" };
    return receiptMessage(
      {
        reference: order.reference,
        title: order.line.title,
        amountKobo: order.amountKobo,
        recordedAt: order.lastCheckedAt ?? row.createdAt,
        testMode: PAYMENTS_IN_TEST_MODE,
      },
      origin,
    );
  }
  const [refund] = await tx
    .select()
    .from(valoRefundRequests)
    .where(
      and(eq(valoRefundRequests.workspaceId, row.workspaceId), eq(valoRefundRequests.id, row.subjectId)),
    );
  if (!refund) return { status: "cancelled", reason: "RECORD_NOT_FOUND" };
  if (refund.status !== "processed") return { status: "cancelled", reason: "REFUND_NOT_PROCESSED" };
  const [order] = await tx
    .select({ reference: valoOrders.reference })
    .from(valoOrders)
    .where(and(eq(valoOrders.workspaceId, row.workspaceId), eq(valoOrders.id, refund.orderId)));
  const [owed] = await tx
    .select({ status: valoPurchaseOutbox.status })
    .from(valoPurchaseOutbox)
    .where(
      and(
        eq(valoPurchaseOutbox.workspaceId, row.workspaceId),
        eq(valoPurchaseOutbox.orderId, refund.orderId),
        eq(valoPurchaseOutbox.kind, `refund_processed:${refund.id}`),
      ),
    );
  if (!order) return { status: "cancelled", reason: "RECORD_NOT_FOUND" };
  if (!owed || owed.status.startsWith("held_"))
    return { status: "cancelled", reason: "PURCHASE_MESSAGE_HELD" };
  return refundMessage(
    {
      orderReference: order.reference,
      refundReference: refund.reference,
      amountKobo: refund.amountKobo,
      processedAt: refund.completedAt ?? row.createdAt,
      testMode: PAYMENTS_IN_TEST_MODE,
    },
    origin,
  );
}

const unleased = { leaseToken: null, leaseUntil: null } as const;

/**
 * Offers one due message of `workspaceId` to `sender`. It runs in that workspace's database scope: the
 * message, its recipient's membership and the record it is about are the workspace's own rows, and
 * row-level security keeps every read and change to them.
 *
 * The attempt is committed before the sender is called, so a process that dies cannot lose it, and the lease
 * keeps other attempts away meanwhile. No transaction, lock or pooled connection is held while the sender
 * works. The result is recorded in a transaction of its own.
 */
export function dispatchMessage(
  workspaceId: string,
  id: string,
  sender: MessageSender | null,
  now = new Date(),
  env: NodeJS.ProcessEnv = environment(),
) {
  return runInWorkspaceScope(workspaceId, () => offer(workspaceId, id, sender, now, env));
}

async function offer(
  workspaceId: string,
  id: string,
  sender: MessageSender | null,
  now: Date,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const origin = trustedSiteOrigin(env) ?? null;
  const mine = and(eq(valoMessages.workspaceId, workspaceId), eq(valoMessages.id, id));
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(valoMessages).where(mine).for("update");
    if (!row) throw Error("MESSAGE_NOT_FOUND");
    if (["accepted", "failed", "cancelled"].includes(row.status)) return row.status;
    if (
      row.status === "sending" ? (row.leaseUntil ?? now) > now : row.nextAttemptAt && row.nextAttemptAt > now
    )
      return row.status;
    const stop = async (to: Stop) => {
      await tx
        .update(valoMessages)
        .set({
          status: to.status,
          reason: to.reason,
          ...unleased,
          nextAttemptAt: to.status === "held" ? (to.retryAt ?? new Date(+now + HOLD_MS.paused)) : null,
          updatedAt: now,
        })
        .where(mine);
      return to.status;
    };
    const composed = await check(tx, row, origin);
    if ("status" in composed) return stop(composed);
    if (!sender)
      return stop({
        status: "held",
        reason: "SENDER_NOT_CONFIGURED",
        retryAt: new Date(+now + HOLD_MS.noSender),
      });
    const fail = async (reason: string) => {
      await tx
        .update(valoMessages)
        .set({ status: "failed", reason, ...unleased, nextAttemptAt: null, updatedAt: now })
        .where(mine);
      return "failed";
    };
    // The last attempt's process stopped before it recorded a result.
    if (row.attempts >= MESSAGE_ATTEMPT_LIMIT) return fail("ATTEMPT_LIMIT_REACHED");
    // A sender deduplicates retries only for so long. Past that, an earlier attempt it may have taken is
    // never made again, since the message could arrive twice; it fails, for staff to see.
    if (
      sender.replayWindowMs &&
      row.attempts > 0 &&
      (!row.firstAttemptAt || +now - +row.firstAttemptAt >= sender.replayWindowMs)
    )
      return fail("REPLAY_WINDOW_PASSED");
    const token = randomUUID(),
      attempt = row.attempts + 1;
    await tx
      .update(valoMessages)
      .set({
        status: "sending",
        reason: null,
        attempts: attempt,
        firstAttemptAt: row.firstAttemptAt ?? now,
        lastAttemptAt: now,
        leaseToken: token,
        leaseUntil: new Date(+now + LEASE_MS),
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(mine);
    return { token, attempt, row, composed };
  });
  if (typeof claim === "string") return claim;
  // Unreachable: without a sender the claim above holds the message instead.
  if (!sender) throw Error("MESSAGE_SENDER_MISSING");
  let providerMessageId: string | undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Error("MESSAGE_SENDER_TIMEOUT"));
      }, SEND_TIMEOUT_MS);
    });
    const taken = await Promise.race([
      sender.send({
        messageId: claim.row.id,
        idempotencyKey: providerKey(claim.row.id),
        kind: claim.row.kind,
        recipient: { identityId: claim.row.recipientIdentityId },
        subject: claim.composed.subject,
        text: claim.composed.text,
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!taken.providerMessageId?.trim()) throw Error("MESSAGE_SENDER_REFERENCE_MISSING");
    providerMessageId = taken.providerMessageId.slice(0, 200);
  } catch {
    // A refusal, a timeout or no answer: the sender may still have taken the message, so a retry offers it
    // with the same idempotency key, and it is never called taken without the sender's reference.
    providerMessageId = undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(valoMessages).where(mine).for("update");
    if (!row) throw Error("MESSAGE_NOT_FOUND");
    if (row.status === "accepted") return "accepted";
    if (providerMessageId) {
      // A message the sender took is recorded as taken even if it was held or cancelled during the call:
      // it has gone. A later attempt that took over an expired lease records its own result.
      if (row.leaseToken !== null && row.leaseToken !== claim.token) return row.status;
      await tx
        .update(valoMessages)
        .set({
          status: "accepted",
          reason: null,
          sender: sender.name,
          providerMessageId,
          acceptedAt: now,
          ...unleased,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(mine);
      return "accepted";
    }
    // An attempt not taken is recorded only if nothing changed the message since the claim. A retry checks
    // everything again before it calls the sender.
    if (row.leaseToken !== claim.token || row.status !== "sending") return row.status;
    const retryAt = messageRetryAt(claim.attempt, now);
    await tx
      .update(valoMessages)
      .set(
        retryAt
          ? {
              status: "queued",
              reason: "SENDER_DID_NOT_TAKE",
              ...unleased,
              nextAttemptAt: retryAt,
              updatedAt: now,
            }
          : {
              status: "failed",
              reason: "ATTEMPT_LIMIT_REACHED",
              ...unleased,
              nextAttemptAt: null,
              updatedAt: now,
            },
      )
      .where(mine);
    return retryAt ? "queued" : "failed";
  });
}

/**
 * The worker's job (part 1): offers each due message to the configured sender, one at a time, each in its
 * own workspace's scope. Due means queued or held and past its next time, or sending with a lease that
 * expired. The table is the queue; this run only wakes it.
 */
export async function dispatchDueMessages(
  sender: MessageSender | null = configuredMessageSender(),
  now = new Date(),
  scope?: { workspaceId: string },
) {
  // A database the messages migration has not reached owes no message yet.
  if (!(await messagesReady(db))) return { checked: 0, offered: 0, senderConfigured: sender !== null };
  const due = await db
    .select({ id: valoMessages.id, workspaceId: valoMessages.workspaceId })
    .from(valoMessages)
    .where(
      and(
        ...(scope ? [eq(valoMessages.workspaceId, scope.workspaceId)] : []),
        or(
          and(
            inArray(valoMessages.status, ["queued", "held"]),
            or(isNull(valoMessages.nextAttemptAt), lte(valoMessages.nextAttemptAt, now)),
          ),
          and(eq(valoMessages.status, "sending"), lte(valoMessages.leaseUntil, now)),
        ),
      ),
    )
    .orderBy(
      sql`${valoMessages.nextAttemptAt} asc nulls first`,
      asc(valoMessages.createdAt),
      asc(valoMessages.id),
    )
    .limit(25);
  let offered = 0,
    failures = 0;
  const counted: MessageSender | null = sender && {
    name: sender.name,
    replayWindowMs: sender.replayWindowMs,
    send: (message) => {
      offered++;
      return sender.send(message);
    },
  };
  for (const row of due)
    try {
      await dispatchMessage(row.workspaceId, row.id, counted, now);
    } catch {
      failures++;
    }
  if (failures) throw Error(`MESSAGE_BATCH_PARTIALLY_FAILED_${failures}`);
  return { checked: due.length, offered, senderConfigured: sender !== null };
}
