/** Synthetic test data only: workspaces, orders and their messages for the messages module's database tests. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, valoMessages, valoOrders, valoPrices, valoSafetySwitches } from "@workspace/db";
import { resolveWorkspace, type WorkspaceActor } from "../modules/workspaces";
import * as commerce from "../modules/commerce";
import { verifiedTransaction } from "../modules/commerce/valo-paystack-contract";
import { financeHeldFixture } from "../modules/commerce/valo-finance-test-fixture";

/**
 * A price of its own on a held synthetic version, and what the tests make from it. Nothing here is a
 * released product, a real payment or a real message.
 */
export async function messagesFixture() {
  // Each case has a workspace of its own, so a run over one workspace offers that case's messages alone.
  const workspace = () => resolveWorkspace(`synthetic-messages-${randomUUID()}`);
  const held = await financeHeldFixture();
  const priceId = randomUUID(),
    line = {
      title: "CONTROLLED TEST ONLY — synthetic message order",
      contentVersionId: held.id,
      licenceVersion: "controlled-not-approved",
      licenceText: "CONTROLLED TEST ONLY. Not commercial terms approval.",
      taxTreatment: "Test amount only; no tax assertion.",
    };
  await db.insert(valoPrices).values({
    id: priceId,
    contentVersionId: held.id,
    title: line.title,
    amountKobo: 12345,
    licenceVersion: line.licenceVersion,
    licenceText: line.licenceText,
    taxTreatment: line.taxTreatment,
    approvalReference: "CONTROLLED_FIXTURE_NOT_APPROVAL",
    effectiveFrom: new Date(Date.now() - 1000),
  });
  async function order(actor: WorkspaceActor) {
    const id = randomUUID();
    const [row] = await db
      .insert(valoOrders)
      .values({
        id,
        workspaceId: actor.workspaceId,
        requestedBy: actor.identityId,
        requestKey: randomUUID(),
        priceId,
        reference: `valo-test-${id}`,
        amountKobo: 12345,
        line,
      })
      .returning();
    return row!;
  }
  const verified = (o: Awaited<ReturnType<typeof order>>) =>
    verifiedTransaction.parse({
      id: String(Math.floor(Math.random() * 1e12)),
      domain: "test",
      reference: o.reference,
      status: "success",
      amount: o.amountKobo,
      currency: "NGN",
      metadata: { valoOrderId: o.id, workspaceId: o.workspaceId },
    });
  /** A settled order of `actor`'s workspace, with the receipt message its settlement owes. */
  async function settled(actor: WorkspaceActor) {
    const o = await order(actor);
    await commerce.settleVerifiedOrder(o.id, verified(o));
    return { order: o, message: await messageOf("purchase_receipt", o.id) };
  }
  /** The one message of `kind` about a record: in every workspace, or in the one named. */
  async function messageOf(kind: string, subjectId: string, workspaceId?: string) {
    const rows = await db
      .select()
      .from(valoMessages)
      .where(
        and(
          eq(valoMessages.kind, kind),
          eq(valoMessages.subjectId, subjectId),
          ...(workspaceId ? [eq(valoMessages.workspaceId, workspaceId)] : []),
        ),
      );
    assert.equal(rows.length, 1, `one ${kind} message for its record`);
    return rows[0]!;
  }
  const row = async (id: string) => (await db.select().from(valoMessages).where(eq(valoMessages.id, id)))[0]!;
  const [pauseBefore] = await db
    .select()
    .from(valoSafetySwitches)
    .where(eq(valoSafetySwitches.key, "messages"));
  const setPause = (paused: boolean) =>
    db
      .insert(valoSafetySwitches)
      .values({
        key: "messages",
        enabled: !paused,
        reason: "Synthetic messages test pause",
        actorId: "synthetic-messages-test",
      })
      .onConflictDoUpdate({
        target: valoSafetySwitches.key,
        set: { enabled: !paused, updatedAt: new Date() },
      });
  /** Puts the staff pause back as the test found it. */
  async function restorePause() {
    if (pauseBefore)
      await db
        .update(valoSafetySwitches)
        .set({ enabled: pauseBefore.enabled, reason: pauseBefore.reason, actorId: pauseBefore.actorId })
        .where(eq(valoSafetySwitches.key, "messages"));
    else await db.delete(valoSafetySwitches).where(eq(valoSafetySwitches.key, "messages"));
  }
  return { workspace, line, order, verified, settled, messageOf, row, setPause, restorePause };
}
