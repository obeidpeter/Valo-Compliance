import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  runInWorkspaceScope,
  valoMemberships,
  valoMessages,
  valoOrders,
  valoPrivacyTombstones,
  valoPurchaseOutbox,
  valoRefundRequests,
} from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { privacySigner } from "../../lib/valo-privacy-keys";
import { quotaSubjectHash } from "../../lib/valo-quota";
import * as commerce from "../commerce";
import { workspaceDataExport } from "../privacy/valo-customer-access";
import { guardNestedConnections } from "../../test-support/nested-connection-guard";
import { standInSender, type MessageSender, type OutgoingMessage } from "./message-sender";
import { dispatchDueMessages, dispatchMessage } from "./valo-message-dispatcher";
import { messagesReady, queueMessage } from "./valo-messages";
import { messagesFixture } from "../../test-support/messages-fixture";

/**
 * The outbox and its dispatcher (docs/architecture/messages.md, slice 1a), against the real database: synthetic
 * workspaces, orders and refunds, the stand-in sender, and no real message to anyone.
 */
test(
  "messages wait in the outbox and are offered to the sender once, after every check is made again (WRK-003, WRK-004, PAY-008, PAY-009)",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const { workspace, line, order, verified, settled, messageOf, row, setPause, restorePause } =
      await messagesFixture();
    // Inside a transaction, the dispatcher and commerce use only that transaction's connection.
    const guard = guardNestedConnections({ db, pool });
    try {
      await setPause(false);
      await t.test(
        "a settled order owes one receipt message, to whoever placed it, however often its settlement is replayed",
        async () => {
          const a = await workspace(),
            o = await order(a),
            payment = verified(o);
          await Promise.all(Array.from({ length: 6 }, () => commerce.settleVerifiedOrder(o.id, payment)));
          const message = await messageOf("purchase_receipt", o.id);
          assert.deepEqual(
            {
              workspaceId: message.workspaceId,
              class: message.class,
              recipient: message.recipientIdentityId,
              status: message.status,
              attempts: message.attempts,
              sender: message.sender,
              acceptedAt: message.acceptedAt,
            },
            {
              workspaceId: a.workspaceId,
              class: "necessary",
              recipient: a.identityId,
              status: "queued",
              attempts: 0,
              sender: null,
              acceptedAt: null,
            },
          );
          // The ledger's row lost and repaired on the next replay: the repair owes the message again, and it
          // is still the one message.
          await db.delete(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, o.id));
          await commerce.settleVerifiedOrder(o.id, payment);
          assert.equal(
            (await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, o.id))).length,
            1,
          );
          assert.equal((await messageOf("purchase_receipt", o.id)).id, message.id);
          // An order that is only created owes nothing.
          const unpaid = await order(a);
          assert.equal(
            (await db.select().from(valoMessages).where(eq(valoMessages.subjectId, unpaid.id))).length,
            0,
          );
        },
      );

      await t.test(
        "the dispatcher offers a due message once, records the sender's reference and never calls it delivered; duplicate runs offer nothing more",
        async () => {
          const a = await workspace(),
            inA = { workspaceId: a.workspaceId };
          const { order: o, message } = await settled(a);
          const sender = standInSender({ keep: true }),
            now = new Date();
          // Two runs at once, then a third: the lease and the row lock let one offer it.
          const runs = await Promise.all([
            dispatchDueMessages(sender, now, inA),
            dispatchDueMessages(sender, now, inA),
          ]);
          const again = await dispatchDueMessages(sender, new Date(+now + 60000), inA);
          assert.equal(runs[0].offered + runs[1].offered + again.offered, 1);
          const kept = sender.kept;
          assert.equal(kept.length, 1);
          assert.equal(kept[0]!.messageId, message.id);
          const after = await row(message.id);
          assert.equal(after.status, "accepted");
          assert.equal(after.sender, "stand-in");
          assert.equal(after.providerMessageId, kept[0]!.providerMessageId);
          assert.ok(after.acceptedAt);
          assert.equal(after.attempts, 1);
          assert.equal(after.leaseToken, null);
          // What the sender was handed: the recipient as an identity, never an address, and a key that names
          // nothing about the message.
          assert.deepEqual(kept[0]!.recipient, { identityId: a.identityId });
          assert.equal(kept[0]!.idempotencyKey, `valo-message-v1-${sha256(message.id)}`);
          assert.equal(kept[0]!.subject, `Your Valo receipt for order ${o.reference}`);
          assert.ok(kept[0]!.text.includes("Amount: ₦123.45"));
          assert.ok(kept[0]!.text.includes(`Bought: ${line.title}`));
          assert.ok(!kept[0]!.text.includes("@"));
        },
      );

      await t.test(
        "a pause holds every message until it is removed, and then the message is offered",
        async () => {
          const a = await workspace(),
            inA = { workspaceId: a.workspaceId };
          const { message } = await settled(a);
          const sender = standInSender({ keep: true }),
            now = new Date();
          await setPause(true);
          try {
            const run = await dispatchDueMessages(sender, now, inA);
            assert.equal(run.offered, 0);
            const paused = await row(message.id);
            assert.equal(paused.status, "held");
            assert.equal(paused.reason, "MESSAGES_PAUSED");
            assert.equal(paused.attempts, 0);
            assert.equal(+paused.nextAttemptAt!, +now + 5 * 60000);
          } finally {
            await setPause(false);
          }
          // Not before its next time, then offered.
          assert.equal((await dispatchDueMessages(sender, new Date(+now + 60000), inA)).offered, 0);
          assert.equal((await dispatchDueMessages(sender, new Date(+now + 6 * 60000), inA)).offered, 1);
          assert.equal((await row(message.id)).status, "accepted");
        },
      );

      await t.test("without a sender a message waits, untried", async () => {
        const a = await workspace();
        const { message } = await settled(a);
        const now = new Date();
        const run = await dispatchDueMessages(null, now, { workspaceId: a.workspaceId });
        assert.equal(run.senderConfigured, false);
        const waiting = await row(message.id);
        assert.equal(waiting.status, "held");
        assert.equal(waiting.reason, "SENDER_NOT_CONFIGURED");
        assert.equal(waiting.attempts, 0);
        assert.equal(+waiting.nextAttemptAt!, +now + 15 * 60000);
        // It is offered once a sender is there.
        await dispatchMessage(a.workspaceId, message.id, standInSender(), new Date(+now + 16 * 60000));
        assert.equal((await row(message.id)).status, "accepted");
      });

      await t.test("a message its record no longer owes is cancelled before it is sent", async () => {
        const sender = standInSender({ keep: true }),
          now = new Date();
        const a = await workspace();
        // A payment reversed after it settled.
        const reversed = await settled(a);
        await db.update(valoOrders).set({ status: "reversed" }).where(eq(valoOrders.id, reversed.order.id));
        // A receipt the commerce ledger holds.
        const heldReceipt = await settled(a);
        await db
          .update(valoPurchaseOutbox)
          .set({ status: "held_synthetic_recovery" })
          .where(eq(valoPurchaseOutbox.orderId, heldReceipt.order.id));
        // A buyer who is no longer a member of the workspace.
        const c = await workspace();
        const departed = await settled(c);
        await db
          .update(valoMemberships)
          .set({ active: "no" })
          .where(
            and(eq(valoMemberships.workspaceId, c.workspaceId), eq(valoMemberships.identityId, c.identityId)),
          );
        // A workspace whose erasure has begun.
        const d = await workspace();
        const erased = await settled(d);
        // Recorded as an erasure records it, with the current signing key, so sign-in's own check of erased
        // identities reads it as any other.
        await db.transaction(async (tx) => {
          const signer = await privacySigner(tx);
          await tx.insert(valoPrivacyTombstones).values({
            id: randomUUID(),
            workspaceId: d.workspaceId,
            caseId: randomUUID(),
            identityHash: quotaSubjectHash(signer.key, "user", `synthetic-messages-erased-${randomUUID()}`),
            phase: "erased",
            keyVersion: signer.version,
            // Never due for the erasure's own file clean-up, which has nothing of this fixture's to find.
            nextReplayAt: new Date(Date.now() + 3650 * 86400000),
          });
        });
        for (const [workspaceId, message, reason] of [
          [a.workspaceId, reversed.message, "ORDER_NOT_VERIFIED"],
          [a.workspaceId, heldReceipt.message, "PURCHASE_MESSAGE_HELD"],
          [c.workspaceId, departed.message, "RECIPIENT_NOT_A_MEMBER"],
          [d.workspaceId, erased.message, "WORKSPACE_ERASED"],
        ] as const) {
          assert.equal(await dispatchMessage(workspaceId, message.id, sender, now), "cancelled");
          const after = await row(message.id);
          assert.equal(after.status, "cancelled", reason);
          assert.equal(after.reason, reason);
          assert.equal(after.attempts, 0);
          // A cancelled message is never offered again.
          assert.equal(
            await dispatchMessage(workspaceId, message.id, sender, new Date(+now + 86400000)),
            "cancelled",
          );
        }
        assert.equal(sender.kept.length, 0);
      });

      await t.test(
        "a refund notice is sent only for a refund the provider processed, with its words",
        async () => {
          const a = await workspace();
          const sender = standInSender({ keep: true }),
            now = new Date();
          async function refund(status: string) {
            const { order: o } = await settled(a);
            const id = randomUUID();
            await db.insert(valoRefundRequests).values({
              id,
              workspaceId: a.workspaceId,
              orderId: o.id,
              reason: "Synthetic refund for the messages test",
              status,
              amountKobo: 5000,
              reference: `valo-refund-test-${id}`,
              completedAt: status === "processed" ? new Date("2026-11-19T10:15:00Z") : null,
            });
            await db.insert(valoPurchaseOutbox).values({
              id: randomUUID(),
              workspaceId: a.workspaceId,
              orderId: o.id,
              kind: `refund_processed:${id}`,
            });
            await queueMessage(db, {
              workspaceId: a.workspaceId,
              kind: "refund_processed",
              recipientIdentityId: a.identityId,
              subjectId: id,
            });
            return { order: o, id, message: await messageOf("refund_processed", id) };
          }
          const processed = await refund("processed"),
            requested = await refund("requested");
          assert.equal(await dispatchMessage(a.workspaceId, processed.message.id, sender, now), "accepted");
          assert.equal(await dispatchMessage(a.workspaceId, requested.message.id, sender, now), "cancelled");
          assert.equal((await row(requested.message.id)).reason, "REFUND_NOT_PROCESSED");
          assert.equal(sender.kept.length, 1);
          assert.equal(
            sender.kept[0]!.subject,
            `Your Valo refund on order ${processed.order.reference} was processed`,
          );
          assert.ok(sender.kept[0]!.text.includes("Amount: ₦50.00"));
          assert.ok(sender.kept[0]!.text.includes("Processed: 19 Nov 2026, 11:15 (Lagos time)"));
          assert.ok(
            sender.kept[0]!.text.includes("is not yet confirmation that your bank has credited your account"),
          );
        },
      );

      await t.test(
        "a message the sender does not take is offered again with the same key, five times at most",
        async () => {
          const a = await workspace(),
            inA = { workspaceId: a.workspaceId };
          const { message } = await settled(a);
          const keys: string[] = [];
          const refusing: MessageSender = {
            name: "stand-in",
            async send(m: OutgoingMessage) {
              keys.push(m.idempotencyKey);
              throw Error("SYNTHETIC_SENDER_REFUSED");
            },
          };
          const start = new Date();
          // Each attempt waits 1, 2, 4 and 8 minutes after the one before; the fifth is the last.
          const times = [0, 1, 3, 7, 15].map((minutes) => new Date(+start + minutes * 60000));
          for (const [i, at] of times.entries()) {
            // A run before the message's next time offers nothing.
            if (i > 0)
              assert.equal((await dispatchDueMessages(refusing, new Date(+at - 1000), inA)).offered, 0);
            assert.equal((await dispatchDueMessages(refusing, at, inA)).offered, 1);
            const after = await row(message.id);
            assert.equal(after.attempts, i + 1);
            assert.equal(after.status, i < 4 ? "queued" : "failed");
            assert.equal(after.reason, i < 4 ? "SENDER_DID_NOT_TAKE" : "ATTEMPT_LIMIT_REACHED");
          }
          assert.equal(new Set(keys).size, 1);
          assert.equal(keys.length, 5);
          assert.equal((await dispatchDueMessages(refusing, new Date(+start + 86400000), inA)).offered, 0);
        },
      );

      await t.test(
        "an attempt whose process stopped is offered again once its lease ends, and never past the sender's replay window",
        async () => {
          const a = await workspace();
          const sender = standInSender({ keep: true }),
            now = new Date();
          const stopped = (await settled(a)).message;
          await db
            .update(valoMessages)
            .set({
              status: "sending",
              attempts: 1,
              firstAttemptAt: now,
              lastAttemptAt: now,
              leaseToken: randomUUID(),
              leaseUntil: new Date(+now + 30000),
            })
            .where(eq(valoMessages.id, stopped.id));
          assert.equal(
            await dispatchMessage(a.workspaceId, stopped.id, sender, new Date(+now + 10000)),
            "sending",
          );
          assert.equal(sender.kept.length, 0);
          assert.equal(
            await dispatchMessage(a.workspaceId, stopped.id, sender, new Date(+now + 31000)),
            "accepted",
          );
          assert.equal((await row(stopped.id)).attempts, 2);
          // Past its window a sender may no longer deduplicate the key, so the message is not offered again.
          const stale = (await settled(a)).message;
          await db
            .update(valoMessages)
            .set({
              status: "queued",
              reason: "SENDER_DID_NOT_TAKE",
              attempts: 1,
              firstAttemptAt: new Date(+now - 2 * 3600000),
              lastAttemptAt: new Date(+now - 2 * 3600000),
            })
            .where(eq(valoMessages.id, stale.id));
          const windowed: MessageSender = { ...standInSender(), name: "stand-in", replayWindowMs: 3600000 };
          assert.equal(await dispatchMessage(a.workspaceId, stale.id, windowed, now), "failed");
          assert.equal((await row(stale.id)).reason, "REPLAY_WINDOW_PASSED");
        },
      );

      await t.test(
        "where the messages table is not there yet, nothing is owed and the event that would owe it goes on",
        async () => {
          const a = await workspace(),
            o = await order(a);
          await db.transaction(async (tx) => {
            // As a database is before the messages migration reaches it: no such table by the name a query
            // finds it under. This transaction alone looks where the table is not.
            await tx.execute(sql`set local search_path to pg_catalog`);
            assert.equal(await messagesReady(tx), false);
            assert.equal(
              await queueMessage(tx, {
                workspaceId: a.workspaceId,
                kind: "purchase_receipt",
                recipientIdentityId: a.identityId,
                subjectId: o.id,
              }),
              false,
            );
            // Nothing failed in the transaction, so the event's own work would still commit.
            assert.deepEqual((await tx.execute(sql`select 1 as ok`)).rows, [{ ok: 1 }]);
          });
          assert.equal(
            (await db.select().from(valoMessages).where(eq(valoMessages.subjectId, o.id))).length,
            0,
          );
          assert.equal(await messagesReady(db), true);
        },
      );
      await t.test(
        "a workspace's data download lists its messages and what became of them, and not whom they were for (PRV-003)",
        async () => {
          const a = await workspace(),
            b = await workspace();
          const { order: o, message } = await settled(a);
          await dispatchMessage(a.workspaceId, message.id, standInSender(), new Date());
          const own = await workspaceDataExport(a),
            other = await workspaceDataExport(b);
          const listed = own.data.messages as Record<string, unknown>[];
          assert.equal(listed.length, 1);
          assert.deepEqual(Object.keys(listed[0]!).sort(), [
            "acceptedAt",
            "attempts",
            "class",
            "createdAt",
            "id",
            "kind",
            "reason",
            "sender",
            "status",
            "subjectId",
            "updatedAt",
          ]);
          assert.deepEqual(
            [listed[0]!.id, listed[0]!.kind, listed[0]!.subjectId, listed[0]!.status, listed[0]!.sender],
            [message.id, "purchase_receipt", o.id, "accepted", "stand-in"],
          );
          assert.deepEqual(other.data.messages, []);
        },
      );
      await t.test(
        "a row another workspace holds for the same record's id does not stand in for a workspace's own message (SEC-001)",
        async () => {
          const a = await workspace(),
            b = await workspace();
          const o = await order(a);
          // Before the order settles, another workspace holds a message that names it.
          await queueMessage(db, {
            workspaceId: b.workspaceId,
            kind: "purchase_receipt",
            recipientIdentityId: b.identityId,
            subjectId: o.id,
          });
          const theirs = await messageOf("purchase_receipt", o.id, b.workspaceId);
          await commerce.settleVerifiedOrder(o.id, verified(o));
          const own = await messageOf("purchase_receipt", o.id, a.workspaceId);
          assert.notEqual(own.id, theirs.id);
          const sender = standInSender({ keep: true }),
            now = new Date();
          // The buyer's message goes to the buyer; the other workspace's names no order of its own.
          assert.equal(await dispatchMessage(a.workspaceId, own.id, sender, now), "accepted");
          assert.equal(await dispatchMessage(b.workspaceId, theirs.id, sender, now), "cancelled");
          assert.equal((await row(theirs.id)).reason, "RECORD_NOT_FOUND");
          assert.deepEqual(
            sender.kept.map((m) => [m.messageId, m.recipient.identityId]),
            [[own.id, a.identityId]],
          );
        },
      );
      await t.test(
        "another workspace can neither offer nor read a workspace's message (SEC-001)",
        async () => {
          const a = await workspace(),
            b = await workspace();
          const { message } = await settled(a);
          await assert.rejects(
            dispatchMessage(b.workspaceId, message.id, standInSender(), new Date()),
            /MESSAGE_NOT_FOUND/,
          );
          assert.equal((await row(message.id)).status, "queued");
          // The query is awaited inside the scope: a query only built there would run outside it.
          const read = (workspaceId: string) =>
            runInWorkspaceScope(
              workspaceId,
              async () => await db.select().from(valoMessages).where(eq(valoMessages.id, message.id)),
            );
          assert.equal((await read(b.workspaceId)).length, 0);
          // Its own workspace reads it, and may change its state but not what or whom it is for.
          assert.equal((await read(a.workspaceId)).length, 1);
          await assert.rejects(
            runInWorkspaceScope(a.workspaceId, () =>
              db.transaction((tx) =>
                tx.execute(
                  sql`update valo_messages set recipient_identity_id = 'synthetic-other' where id = ${message.id}::uuid`,
                ),
              ),
            ),
            // The database's own refusal, which the query's error carries as its cause.
            (error: Error) =>
              /permission denied for table valo_messages/.test(
                String((error as { cause?: Error }).cause?.message ?? error.message),
              ),
          );
          // The state it may change, it changes.
          await runInWorkspaceScope(a.workspaceId, () =>
            db.transaction((tx) =>
              tx.execute(
                sql`update valo_messages set status = 'cancelled', reason = 'SYNTHETIC_TEST_CANCEL' where id = ${message.id}::uuid`,
              ),
            ),
          );
          assert.equal((await row(message.id)).status, "cancelled");
          // And another workspace's change reaches no row.
          await runInWorkspaceScope(b.workspaceId, () =>
            db.transaction((tx) =>
              tx.execute(
                sql`update valo_messages set status = 'queued', reason = null where id = ${message.id}::uuid`,
              ),
            ),
          );
          assert.equal((await row(message.id)).status, "cancelled");
        },
      );
    } finally {
      guard.restore();
      await restorePause();
      await pool.end();
    }
  },
);
