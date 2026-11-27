import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  valoMemberships,
  valoMessages,
  valoOrders,
  valoPurchaseOutbox,
  valoRefundRequests,
} from "@workspace/db";
import { ListWorkspaceMessagesResponse } from "@workspace/api-zod";
import { resolveWorkspace, type WorkspaceActor } from "../workspaces";
import { commerceRouter } from "../../routes/valo-commerce";
import { messagesRouter } from "../../routes/valo-messages";
import { ValoProblem } from "../../platform/valo-problem";
import { setting } from "../../platform/settings";
import { quotaLimit, quotaSubjectHash } from "../../lib/valo-quota";
import { guardNestedConnections } from "../../test-support/nested-connection-guard";
import { standInSender, type MessageSender } from "./message-sender";
import { dispatchMessage } from "./valo-message-dispatcher";
import { listWorkspaceMessages } from "./valo-message-log";
import { queueMessage } from "./valo-messages";
import { messagesFixture } from "../../test-support/messages-fixture";

/**
 * The workspace's delivery log and the receipt file (docs/architecture/messages.md, slice 1b), against the
 * real database and, for the file, the real renderer: synthetic workspaces, orders and refunds, the stand-in
 * sender, and no real message to anyone.
 */
test(
  "a workspace's log says what became of each message, never that one reached anyone, and the receipt downloads as a PDF (WRK-003, PAY-009)",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const { workspace, settled, messageOf, row, setPause, restorePause } = await messagesFixture();
    /** A sender that reaches no one either, under a name that is not the stand-in's. */
    const namedSender = (name: string, taken = true): MessageSender => ({
      name,
      async send() {
        if (!taken) throw Error("SYNTHETIC_SENDER_REFUSED");
        return { providerMessageId: `synthetic-provider-reference-${randomUUID()}` };
      },
    });
    /** A processed refund on `actor`'s settled order, with the notice it owes. */
    async function refunded(actor: WorkspaceActor, orderId: string) {
      const id = randomUUID();
      await db.insert(valoRefundRequests).values({
        id,
        workspaceId: actor.workspaceId,
        orderId,
        reason: "Synthetic refund for the message log test",
        status: "processed",
        amountKobo: 5000,
        reference: `valo-refund-test-${id}`,
        completedAt: new Date("2026-11-19T10:15:00Z"),
      });
      await db.insert(valoPurchaseOutbox).values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        orderId,
        kind: `refund_processed:${id}`,
      });
      await queueMessage(db, {
        workspaceId: actor.workspaceId,
        kind: "refund_processed",
        recipientIdentityId: actor.identityId,
        subjectId: id,
      });
      return { id, reference: `valo-refund-test-${id}`, message: await messageOf("refund_processed", id) };
    }
    /** The log's entry for one message, as `actor` reads it. */
    const entry = async (actor: WorkspaceActor, id: string) =>
      (await listWorkspaceMessages(actor)).find((message) => message.id === id);
    // Inside a transaction, the log and the dispatcher use only that transaction's connection.
    const guard = guardNestedConnections({ db, pool });
    try {
      await setPause(false);
      await t.test(
        "the log lists a receipt's message and a refund's notice, newest first, each with the order it is about",
        async () => {
          const a = await workspace();
          const { order, message } = await settled(a);
          const refund = await refunded(a, order.id);
          // The receipt's message is the older of the two.
          await db
            .update(valoMessages)
            .set({ createdAt: new Date(Date.now() - 60000) })
            .where(eq(valoMessages.id, message.id));
          const log = ListWorkspaceMessagesResponse.parse(await listWorkspaceMessages(a));
          assert.deepEqual(
            log.map((listed) => [
              listed.id,
              listed.kind,
              listed.orderId,
              listed.orderReference,
              listed.refundReference,
            ]),
            [
              [refund.message.id, "refund_processed", order.id, order.reference, refund.reference],
              [message.id, "purchase_receipt", order.id, order.reference, null],
            ],
          );
          for (const listed of log)
            assert.deepEqual(
              [listed.forYou, listed.status, listed.reason, listed.attempts, listed.acceptedAt],
              [true, "queued", null, 0, null],
            );
          // What an entry holds, and nothing else: no recipient, no sender, no provider reference, no lease.
          assert.deepEqual(Object.keys(log[0]!).sort(), [
            "acceptedAt",
            "attempts",
            "createdAt",
            "delivery",
            "deliveryAt",
            "forYou",
            "id",
            "kind",
            "lastAttemptAt",
            "nextAttemptAt",
            "orderId",
            "orderReference",
            "reason",
            "refundReference",
            "status",
          ]);
        },
      );
      await t.test(
        "a message the stand-in took is called recorded, never accepted, and one an email service took has no delivery until that service reports one",
        async () => {
          const a = await workspace(),
            now = new Date();
          // No sender: the message waits, and the log says why.
          const waiting = await settled(a);
          await dispatchMessage(a.workspaceId, waiting.message.id, null, now);
          assert.deepEqual(
            await entry(a, waiting.message.id).then((listed) => [
              listed?.status,
              listed?.reason,
              listed?.attempts,
              listed?.nextAttemptAt,
            ]),
            ["held", "SENDER_NOT_CONFIGURED", 0, new Date(+now + 15 * 60000).toISOString()],
          );
          // The stand-in sends nothing to anyone: its message is recorded, and the log does not say accepted.
          const standIn = await settled(a);
          await dispatchMessage(a.workspaceId, standIn.message.id, standInSender(), now);
          assert.deepEqual(
            [(await row(standIn.message.id)).status, (await row(standIn.message.id)).sender],
            ["accepted", "stand-in"],
          );
          const recorded = await entry(a, standIn.message.id);
          assert.deepEqual(
            [recorded?.status, recorded?.reason, recorded?.attempts, recorded?.acceptedAt],
            ["recorded", null, 1, now.toISOString()],
          );
          // A sender of another name took it: accepted, which is all the log ever says of it.
          const taken = await settled(a);
          await dispatchMessage(a.workspaceId, taken.message.id, namedSender("synthetic-email-service"), now);
          const accepted = await entry(a, taken.message.id);
          assert.deepEqual([accepted?.status, accepted?.acceptedAt], ["accepted", now.toISOString()]);
          // No state is a delivery, and no message here has a report of one: no email service reported
          // anything. What a report then shows is valo-email-events.integration.test.ts's to prove.
          const log = await listWorkspaceMessages(a);
          assert.ok(log.every((listed) => !["sent", "delivered"].includes(listed.status)));
          assert.ok(log.every((listed) => listed.delivery === null && listed.deliveryAt === null));
          // Nor does it name a sender, its reference for a message, or whom a message is for.
          const written = JSON.stringify(log);
          for (const hidden of [
            "stand-in",
            "synthetic-email-service",
            (await row(standIn.message.id)).providerMessageId!,
            (await row(taken.message.id)).providerMessageId!,
            a.identityId,
          ])
            assert.ok(!written.includes(hidden), `the log must not hold ${hidden}`);
        },
      );
      await t.test("the log says why a message waits, was not taken, failed or was cancelled", async () => {
        const a = await workspace(),
          now = new Date();
        // Paused by staff.
        const paused = await settled(a);
        await setPause(true);
        try {
          await dispatchMessage(a.workspaceId, paused.message.id, standInSender(), now);
        } finally {
          await setPause(false);
        }
        // Not taken once: it waits for its next try.
        const refused = await settled(a);
        await dispatchMessage(
          a.workspaceId,
          refused.message.id,
          namedSender("synthetic-email-service", false),
          now,
        );
        // Not taken five times: it failed.
        const failed = await settled(a);
        for (let attempt = 0; attempt < 5; attempt++)
          await dispatchMessage(
            a.workspaceId,
            failed.message.id,
            namedSender("synthetic-email-service", false),
            new Date(+now + attempt * 3600000),
          );
        // Its payment reversed before it was sent: cancelled.
        const reversed = await settled(a);
        await db.update(valoOrders).set({ status: "reversed" }).where(eq(valoOrders.id, reversed.order.id));
        await dispatchMessage(a.workspaceId, reversed.message.id, standInSender(), now);
        const log = await listWorkspaceMessages(a);
        const said = (id: string) => {
          const listed = log.find((message) => message.id === id)!;
          return [listed.status, listed.reason, listed.attempts, listed.nextAttemptAt !== null];
        };
        assert.deepEqual(said(paused.message.id), ["held", "MESSAGES_PAUSED", 0, true]);
        assert.deepEqual(said(refused.message.id), ["queued", "SENDER_DID_NOT_TAKE", 1, true]);
        assert.deepEqual(said(failed.message.id), ["failed", "ATTEMPT_LIMIT_REACHED", 5, false]);
        assert.deepEqual(said(reversed.message.id), ["cancelled", "ORDER_NOT_VERIFIED", 0, false]);
      });
      await t.test(
        "another member reads the workspace's log and is told only that a message is not theirs; another workspace and a person who is no member read none of it (SEC-001)",
        async () => {
          const a = await workspace(),
            b = await workspace();
          const { message } = await settled(a);
          // A second member of the first workspace.
          const memberId = `synthetic-messages-member-${randomUUID()}`;
          await db.insert(valoMemberships).values({
            id: randomUUID(),
            workspaceId: a.workspaceId,
            identityId: memberId,
            role: "member",
          });
          const member = await resolveWorkspace(memberId);
          assert.equal(member.workspaceId, a.workspaceId);
          assert.equal((await entry(a, message.id))?.forYou, true);
          const theirs = await entry(member, message.id);
          assert.equal(theirs?.forYou, false);
          assert.ok(!JSON.stringify(theirs).includes(a.identityId));
          // Another workspace's log has none of it.
          assert.deepEqual(await listWorkspaceMessages(b), []);
          // A member who has left is refused.
          await db
            .update(valoMemberships)
            .set({ active: "no" })
            .where(eq(valoMemberships.identityId, memberId));
          await assert.rejects(() => listWorkspaceMessages(member), { status: 403 });
        },
      );
      await t.test(
        "the API lists the log and downloads the receipt as a real PDF under its notice, refuses another workspace and an unpaid order, and counts each file made (PAY-009, SEC-005)",
        async () => {
          const a = await workspace(),
            b = await workspace();
          const { order: paid, message } = await settled(a);
          const unpaid = (
            await db
              .insert(valoOrders)
              .values({
                ...paid,
                id: randomUUID(),
                requestKey: randomUUID(),
                reference: `valo-test-${randomUUID()}`,
                status: "created",
                providerTransactionId: null,
                lastCheckedAt: null,
              })
              .returning()
          )[0]!;
          const actors: Record<string, WorkspaceActor> = { owner: a, other: b };
          const app = express();
          app.use((req, res, next) => {
            const who = actors[req.header("x-test-member") ?? ""];
            if (!who) {
              res.status(401).json({ error: "Controlled member required" });
              return;
            }
            res.locals.valoActor = who;
            next();
          });
          app.use(commerceRouter, messagesRouter);
          app.use((e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
            res
              .status(e instanceof ValoProblem ? e.status : e instanceof z.ZodError ? 422 : 503)
              .json({ error: e instanceof Error ? e.message : "Unavailable" }),
          );
          const server = app.listen(0, "127.0.0.1");
          await new Promise<void>((r) => server.once("listening", r));
          const address = server.address();
          if (!address || typeof address === "string") throw Error("LISTENER_REQUIRED");
          const get = (path: string, member: string) =>
            fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { "x-test-member": member } });
          /** How many files the owner has asked for, by the counter the limit reads. */
          const ownerHash = quotaSubjectHash(setting("SESSION_SECRET"), "user", a.identityId);
          const filesCounted = async () =>
            Number(
              (
                await pool.query<{ used: string }>(
                  "SELECT COALESCE(sum(used_count), 0) AS used FROM valo_rate_buckets WHERE bucket = 'export-create' AND subject_hash = $1",
                  [ownerHash],
                )
              ).rows[0]!.used,
            );
          try {
            const listed = await get("/workspace/messages", "owner");
            assert.equal(listed.status, 200);
            assert.match(listed.headers.get("cache-control") ?? "", /no-store/);
            const log = ListWorkspaceMessagesResponse.parse(await listed.json());
            assert.deepEqual(
              log.map((entry) => [entry.id, entry.orderReference]),
              [[message.id, paid.reference]],
            );
            assert.deepEqual(await (await get("/workspace/messages", "other")).json(), []);

            const file = await get(`/workspace/orders/${paid.id}/receipt/file`, "owner");
            assert.equal(file.status, 200);
            assert.equal(file.headers.get("content-type"), "application/pdf");
            assert.equal(
              file.headers.get("content-disposition"),
              `attachment; filename="VALO-TEST-${paid.reference}.pdf"`,
            );
            assert.match(file.headers.get("cache-control") ?? "", /private, no-store/);
            assert.equal(file.headers.get("x-content-type-options"), "nosniff");
            const bytes = Buffer.from(await file.arrayBuffer());
            assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
            assert.equal(Number(file.headers.get("content-length")), bytes.length);
            // Read by a reader that is not the one that made it.
            const extracted = spawnSync("pdftotext", ["-", "-"], {
              input: bytes,
              encoding: "utf8",
              maxBuffer: 100000,
            });
            assert.equal(
              extracted.error,
              undefined,
              "The independent pdftotext reader must be installed; no PDF-read pass is inferred without it.",
            );
            assert.equal(extracted.status, 0);
            const text = extracted.stdout.replace(/\s+/g, " ");
            assert.ok(text.includes(`Order reference: ${paid.reference}`));
            assert.match(text, /Original amount NGN 123\.45/);
            // PAY-009: the receipt says what it is not.
            assert.match(text, /VALO DEVELOPMENT PURCHASE RECEIPT/);
            assert.match(
              text,
              /Not proof of delivery, bank outcome, a government tax invoice or official approval/,
            );

            // Another workspace's member learns nothing of the order; an unpaid order has no receipt to make.
            assert.equal((await get(`/workspace/orders/${paid.id}/receipt/file`, "other")).status, 404);
            const none = await get(`/workspace/orders/${unpaid.id}/receipt/file`, "owner");
            assert.equal(none.status, 409);
            assert.match(none.headers.get("content-type") ?? "", /json/);
            // Each file the owner asked for was counted with the files a member asks Valo to make, the
            // refused one too; another member's requests were counted as theirs.
            assert.equal(await filesCounted(), 2);
            // At the limit, in this minute and the next, no file is made.
            await pool.query(
              `INSERT INTO valo_rate_buckets (bucket, subject_hash, window_started_at, used_count, expires_at)
               SELECT 'export-create', $1, started, $2, started + interval '2 minutes'
               FROM (SELECT date_trunc('minute', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + step AS started
                     FROM (VALUES (interval '0'), (interval '1 minute')) AS steps(step)) AS windows
               ON CONFLICT (bucket, subject_hash, window_started_at) DO UPDATE SET used_count = EXCLUDED.used_count`,
              [ownerHash, quotaLimit("export-create")],
            );
            const limited = await get(`/workspace/orders/${paid.id}/receipt/file`, "owner");
            assert.equal(limited.status, 429);
            assert.ok(Number(limited.headers.get("retry-after")) > 0);
            assert.match(
              String(((await limited.json()) as { error?: unknown }).error),
              /Too many files asked for/,
            );
          } finally {
            await pool.query(
              "DELETE FROM valo_rate_buckets WHERE bucket = 'export-create' AND subject_hash = $1",
              [ownerHash],
            );
            await new Promise<void>((r) => server.close(() => r()));
          }
        },
      );
    } finally {
      guard.restore();
      await restorePause();
      await pool.end();
    }
  },
);
