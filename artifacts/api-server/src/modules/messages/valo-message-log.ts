import { and, desc, eq, inArray } from "drizzle-orm";
import { db, valoMessages, valoNoticeDigests, valoOrders, valoRefundRequests } from "@workspace/db";
import { authorizeWorkspaceRead, type WorkspaceActor } from "../workspaces";
import { STAND_IN_SENDER } from "./message-sender";
import { deliveriesOf } from "./valo-email-events";
import { messagesReady } from "./valo-messages";

/** How many of a workspace's latest messages its log lists. */
const LOG_LIMIT = 200;

/**
 * What a message's state is called in the workspace's log. A message a sender took is `accepted`, which
 * never means delivered: nothing here records a delivery. One the stand-in took was sent to no one, so the
 * log calls it `recorded`, and a reader cannot take it for an email that went.
 */
export function logStatus(row: { status: string; sender: string | null }) {
  return row.status === "accepted" && row.sender === STAND_IN_SENDER ? "recorded" : row.status;
}

/**
 * The workspace's delivery log (docs/architecture/messages.md, part 1): each message Valo owes the
 * workspace and what became of it, newest first, for any member who may read the workspace. It names the
 * order each message is about, the refund for a refund notice, and the day for a day's notices. It says
 * whether the message is for the member asking, and never who else it is for. It gives no message text,
 * no address, and nothing of the sender's but whether one took the message and what the email service has
 * reported about it since. A delivery is that service's report alone, and only a message a sender that
 * sends took can have one.
 *
 * A database the messages migration has not reached has none to list.
 */
export async function listWorkspaceMessages(actor: WorkspaceActor) {
  return db.transaction(async (tx) => {
    await authorizeWorkspaceRead(tx, actor);
    if (!(await messagesReady(tx))) return [];
    const rows = await tx
      .select()
      .from(valoMessages)
      .where(eq(valoMessages.workspaceId, actor.workspaceId))
      .orderBy(desc(valoMessages.createdAt), desc(valoMessages.id))
      .limit(LOG_LIMIT);
    const refundIds = rows.filter((row) => row.kind === "refund_processed").map((row) => row.subjectId);
    const refunds = refundIds.length
      ? await tx
          .select({
            id: valoRefundRequests.id,
            orderId: valoRefundRequests.orderId,
            reference: valoRefundRequests.reference,
          })
          .from(valoRefundRequests)
          .where(
            and(
              eq(valoRefundRequests.workspaceId, actor.workspaceId),
              inArray(valoRefundRequests.id, refundIds),
            ),
          )
      : [];
    const refundOf = new Map(refunds.map((refund) => [refund.id, refund]));
    const orderIds = [
      ...new Set([
        ...rows.filter((row) => row.kind === "purchase_receipt").map((row) => row.subjectId),
        ...refunds.map((refund) => refund.orderId),
      ]),
    ];
    const orders = orderIds.length
      ? await tx
          .select({ id: valoOrders.id, reference: valoOrders.reference })
          .from(valoOrders)
          .where(and(eq(valoOrders.workspaceId, actor.workspaceId), inArray(valoOrders.id, orderIds)))
      : [];
    const orderReference = new Map(orders.map((order) => [order.id, order.reference]));
    const digestIds = rows.filter((row) => row.kind === "notices_digest").map((row) => row.subjectId);
    const digests = digestIds.length
      ? await tx
          .select({ id: valoNoticeDigests.id, day: valoNoticeDigests.day })
          .from(valoNoticeDigests)
          .where(
            and(
              eq(valoNoticeDigests.workspaceId, actor.workspaceId),
              inArray(valoNoticeDigests.id, digestIds),
            ),
          )
      : [];
    const dayOf = new Map(digests.map((digest) => [digest.id, digest.day]));
    const reports = await deliveriesOf(
      tx,
      actor.workspaceId,
      "message",
      rows.filter((row) => row.status === "accepted" && row.sender !== STAND_IN_SENDER).map((row) => row.id),
    );
    return rows.map((row) => {
      const refund = row.kind === "refund_processed" ? refundOf.get(row.subjectId) : undefined;
      const orderId = row.kind === "purchase_receipt" ? row.subjectId : (refund?.orderId ?? null);
      // An order or a refund this workspace no longer holds is not named.
      const known = orderId !== null && orderReference.has(orderId);
      return {
        id: row.id,
        kind: row.kind,
        orderId: known ? orderId : null,
        orderReference: known ? orderReference.get(orderId)! : null,
        refundReference: refund?.reference ?? null,
        // The Lagos day a notices message is about; none for any other kind.
        noticesDay: row.kind === "notices_digest" ? (dayOf.get(row.subjectId) ?? null) : null,
        forYou: row.recipientIdentityId === actor.identityId,
        status: logStatus(row),
        reason: row.reason,
        attempts: row.attempts,
        createdAt: row.createdAt.toISOString(),
        lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        delivery: reports.get(row.id)?.delivery ?? null,
        deliveryAt: reports.get(row.id)?.deliveryAt ?? null,
      };
    });
  });
}
