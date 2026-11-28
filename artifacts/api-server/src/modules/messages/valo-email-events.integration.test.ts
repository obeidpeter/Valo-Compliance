import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  runInWorkspaceScope,
  valoEmailEvents,
  valoMessageDeliveries,
  valoReminderOutbox,
} from "@workspace/db";
import { ListRemindersResponse, ListWorkspaceMessagesResponse } from "@workspace/api-zod";
import type { WorkspaceActor } from "../workspaces";
import { workspaceDataExport } from "../privacy/valo-customer-access";
import { createTask, listReminders, reminderInstant, saveReminderPreferences } from "../tasks/valo-tasks";
import { processReminder } from "../tasks/valo-reminder-worker";
import { guardNestedConnections } from "../../test-support/nested-connection-guard";
import { messagesFixture } from "../../test-support/messages-fixture";
import type { Delivery } from "./email-events";
import { runMessagesJob } from "./messages-job";
import { standInSender, type MessageSender } from "./message-sender";
import { deliveriesOf, emailEventsReady, recordDeliveryReports, recordEmailEvent } from "./valo-email-events";
import { dispatchMessage } from "./valo-message-dispatcher";
import { listWorkspaceMessages } from "./valo-message-log";

/**
 * What the email provider reports about a message it took (docs/architecture/messages.md, slice 2a),
 * against the real database: synthetic workspaces, orders and reminders, senders that reach no one, and
 * reports this test makes itself. No provider is called and no message reaches anyone.
 *
 * Other test files share this database, so the test moves its own rows' times and never the clock: a run
 * of the job here treats every other report as the worker would.
 */
test(
  "the email service's reports are recorded on the message or reminder they are about, whatever their order, and never on a message sent to no one (WRK-003)",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const { workspace, settled, row, setPause, restorePause } = await messagesFixture();
    /** A sender that reaches no one, under a provider's name, giving each message the reference it is told to. */
    const providerSender = (name: string, reference = randomUUID()): MessageSender => ({
      name,
      send: async () => ({ providerMessageId: reference }),
    });
    /** A receipt's message of `actor`'s workspace, taken by a sender named as the provider. */
    async function taken(actor: WorkspaceActor, sender: MessageSender = providerSender("resend")) {
      const { order, message } = await settled(actor);
      assert.equal(await dispatchMessage(actor.workspaceId, message.id, sender, new Date()), "accepted");
      const accepted = await row(message.id);
      return { order, id: message.id, reference: accepted.providerMessageId! };
    }
    const made: string[] = [];
    /** One report, kept as the webhook keeps it. */
    async function report(
      delivery: Delivery,
      providerMessageId: string,
      about: { detail?: string; occurredAt?: Date; provider?: string; eventKey?: string } = {},
    ) {
      const eventKey = about.eventKey ?? `msg_synthetic_${randomUUID()}`;
      const outcome = await recordEmailEvent(about.provider ?? "resend", eventKey, {
        delivery,
        detail: about.detail ?? null,
        providerMessageId,
        occurredAt: about.occurredAt ?? new Date(),
      });
      made.push(eventKey);
      return { eventKey, outcome };
    }
    const eventOf = async (eventKey: string) =>
      (await db.select().from(valoEmailEvents).where(eq(valoEmailEvents.eventKey, eventKey)))[0];
    const deliveryOf = async (source: "message" | "reminder", recordId: string) =>
      (
        await db
          .select()
          .from(valoMessageDeliveries)
          .where(and(eq(valoMessageDeliveries.source, source), eq(valoMessageDeliveries.recordId, recordId)))
      )[0];
    /** The log's entry for one message, as `actor` reads it, checked against the API's contract. */
    const entry = async (actor: WorkspaceActor, id: string) =>
      ListWorkspaceMessagesResponse.parse(await listWorkspaceMessages(actor)).find(
        (message) => message.id === id,
      )!;
    // One reading of the clock for the whole test. A report's time is compared with the same time made
    // again, and a clock read each time gave a later second once a second's boundary fell between them.
    const started = Math.floor(Date.now() / 1000) * 1000;
    const at = (minutesAgo: number) => new Date(started - minutesAgo * 60_000);
    // Inside a transaction, the job and the log use only that transaction's connection.
    const guard = guardNestedConnections({ db, pool });
    try {
      await setPause(false);
      await t.test(
        "a message a provider took is shown as delivered only once the provider reports it, with the provider's time",
        async () => {
          const a = await workspace();
          const message = await taken(a);
          // Taken, and nothing reported: accepted is all the log says.
          assert.deepEqual(
            [(await entry(a, message.id)).status, (await entry(a, message.id)).delivery],
            ["accepted", null],
          );
          const delivered = at(3);
          const first = await report("delivered", message.reference, { occurredAt: delivered });
          assert.equal(first.outcome, "kept");
          // The provider delivers a report again under the same id: it is one report.
          assert.equal(
            (await report("delivered", message.reference, { eventKey: first.eventKey })).outcome,
            "duplicate",
          );
          assert.equal((await eventOf(first.eventKey))!.status, "pending");
          // Kept is not yet recorded: the log changes when the job has run.
          assert.equal((await entry(a, message.id)).delivery, null);
          await recordDeliveryReports();
          const settledEvent = (await eventOf(first.eventKey))!;
          assert.equal(settledEvent.status, "applied");
          assert.ok(settledEvent.settledAt);
          const listed = await entry(a, message.id);
          assert.deepEqual(
            [listed.status, listed.delivery, listed.deliveryAt],
            ["accepted", "delivered", delivered.toISOString()],
          );
          const kept = (await deliveryOf("message", message.id))!;
          assert.deepEqual(
            [kept.workspaceId, kept.delivery, kept.detail, kept.reportedAt.toISOString()],
            [a.workspaceId, "delivered", null, delivered.toISOString()],
          );
          // The message's own row says what it said before: taken, by that sender.
          assert.deepEqual(
            [(await row(message.id)).status, (await row(message.id)).sender],
            ["accepted", "resend"],
          );
          // A run with nothing new changes nothing.
          await recordDeliveryReports();
          assert.deepEqual((await deliveryOf("message", message.id))!.updatedAt, kept.updatedAt);
        },
      );

      await t.test(
        "reports about one message leave the same record in whatever order they arrive, each run or all at once",
        async () => {
          const a = await workspace();
          // Marked as spam, then the delivery that came before it, then a delay from before that.
          const late = await taken(a);
          for (const [delivery, minutesAgo, expected] of [
            ["complained", 1, "complained"],
            ["delivered", 2, "complained"],
            ["delayed", 3, "complained"],
          ] as const) {
            await report(delivery, late.reference, { occurredAt: at(minutesAgo) });
            await recordDeliveryReports();
            const listed = await entry(a, late.id);
            assert.deepEqual([listed.delivery, listed.deliveryAt], [expected, at(1).toISOString()], delivery);
          }
          // Delayed, delivered and sent back, all waiting for one run.
          const together = await taken(a);
          const keys = [];
          for (const [delivery, minutesAgo, detail] of [
            ["bounced", 1, "PERMANENT"],
            ["delayed", 3, undefined],
            ["delivered", 2, undefined],
          ] as const)
            keys.push(
              (
                await report(delivery, together.reference, {
                  occurredAt: at(minutesAgo),
                  ...(detail ? { detail } : {}),
                })
              ).eventKey,
            );
          await recordDeliveryReports();
          for (const key of keys) assert.equal((await eventOf(key))!.status, "applied", key);
          const kept = (await deliveryOf("message", together.id))!;
          assert.deepEqual(
            [kept.delivery, kept.detail, kept.reportedAt.toISOString()],
            ["bounced", "PERMANENT", at(1).toISOString()],
          );
          assert.equal((await entry(a, together.id)).delivery, "bounced");
          // A record has one row, however many reports there were.
          assert.equal(
            (
              await db
                .select()
                .from(valoMessageDeliveries)
                .where(eq(valoMessageDeliveries.workspaceId, a.workspaceId))
            ).length,
            2,
          );
        },
      );

      await t.test(
        "a message the stand-in took is never given a report, whatever reference a report names",
        async () => {
          const a = await workspace();
          const { order: _order, message } = await settled(a);
          assert.equal(
            await dispatchMessage(a.workspaceId, message.id, standInSender(), new Date()),
            "accepted",
          );
          const recorded = await row(message.id);
          assert.equal(recorded.sender, "stand-in");
          // A report that names the stand-in's own reference, as no provider's could.
          const named = await report("delivered", recorded.providerMessageId!);
          await recordDeliveryReports();
          assert.equal((await eventOf(named.eventKey))!.status, "pending");
          assert.equal(await deliveryOf("message", message.id), undefined);
          assert.deepEqual(
            [(await entry(a, message.id)).status, (await entry(a, message.id)).delivery],
            ["recorded", null],
          );
          // An hour on, the report is about nothing: it is settled as unmatched, and still recorded nowhere.
          await db
            .update(valoEmailEvents)
            .set({ receivedAt: at(61) })
            .where(eq(valoEmailEvents.eventKey, named.eventKey));
          await recordDeliveryReports();
          const unmatched = (await eventOf(named.eventKey))!;
          assert.equal(unmatched.status, "unmatched");
          assert.ok(unmatched.settledAt);
          assert.equal(await deliveryOf("message", message.id), undefined);
          // Even a report's row written by hand does not make the log call it delivered.
          await db.insert(valoMessageDeliveries).values({
            id: randomUUID(),
            workspaceId: a.workspaceId,
            source: "message",
            recordId: message.id,
            delivery: "delivered",
            reportedAt: new Date(),
          });
          assert.deepEqual(
            [(await entry(a, message.id)).status, (await entry(a, message.id)).delivery],
            ["recorded", null],
          );
        },
      );

      await t.test(
        "a report that arrives before its message holds the provider's reference waits for it, and one from another provider is not about it",
        async () => {
          const a = await workspace();
          const reference = randomUUID();
          const early = await report("delivered", reference, { occurredAt: at(2) });
          await recordDeliveryReports();
          assert.equal((await eventOf(early.eventKey))!.status, "pending");
          const message = await taken(a, providerSender("resend", reference));
          // Another provider's report naming the same reference is not this sender's.
          const other = await report("bounced", reference, { provider: "another-provider" });
          await recordDeliveryReports();
          assert.equal((await eventOf(early.eventKey))!.status, "applied");
          assert.equal((await eventOf(other.eventKey))!.status, "pending");
          assert.equal((await entry(a, message.id)).delivery, "delivered");
        },
      );

      await t.test(
        "a reminder's report is recorded on the reminder, and its time of delivery stays when it is later marked as spam",
        async () => {
          const a = await workspace();
          const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
            now = new Date(+reminderInstant(due, 1) + 1);
          await saveReminderPreferences(a, { enabled: true, offsets: [1], expectedRevision: 0 });
          const task = await createTask(a, {
            title: "Controlled reminder for a delivery report",
            notes: "Synthetic only",
            dueDate: due,
            dateConfirmed: true,
            assessmentId: null,
            ruleId: null,
          });
          const [reminder] = await db
            .select()
            .from(valoReminderOutbox)
            .where(eq(valoReminderOutbox.taskId, task.id));
          const reference = randomUUID();
          assert.equal(
            await processReminder(
              a.workspaceId,
              reminder!.id,
              { send: async () => ({ providerMessageId: reference }) },
              now,
            ),
            "sent",
          );
          const listed = async () =>
            ListRemindersResponse.parse(await listReminders(a)).find((r) => r.id === reminder!.id)!;
          assert.deepEqual(
            [(await listed()).status, (await listed()).delivery, (await listed()).deliveredAt],
            ["sent", null, null],
          );
          // The reminders' adapter sends through one provider: another's report is not about a reminder.
          const other = await report("delivered", reference, { provider: "another-provider" });
          await recordDeliveryReports();
          assert.equal((await eventOf(other.eventKey))!.status, "pending");
          assert.equal((await listed()).delivery, null);
          const delivered = at(5);
          await report("delivered", reference, { occurredAt: delivered });
          await recordDeliveryReports();
          assert.deepEqual(
            [(await listed()).delivery, (await listed()).deliveryAt, (await listed()).deliveredAt],
            ["delivered", delivered.toISOString(), delivered.toISOString()],
          );
          const complained = at(1);
          await report("complained", reference, { occurredAt: complained });
          await recordDeliveryReports();
          assert.deepEqual(
            [(await listed()).delivery, (await listed()).deliveryAt, (await listed()).deliveredAt],
            ["complained", complained.toISOString(), delivered.toISOString()],
          );
          assert.equal((await deliveryOf("reminder", reminder!.id))!.workspaceId, a.workspaceId);
          // The reminder's own state is what it was: accepted by the email service.
          assert.equal((await listed()).status, "sent");
        },
      );

      await t.test(
        "another workspace is shown none of it and can neither read nor write it, and a data download lists its own reports alone (SEC-001, PRV-003)",
        async () => {
          const a = await workspace(),
            b = await workspace();
          const message = await taken(a);
          await report("delivered", message.reference, { occurredAt: at(1) });
          await recordDeliveryReports();
          assert.equal((await entry(a, message.id)).delivery, "delivered");
          assert.deepEqual(await listWorkspaceMessages(b), []);
          // Asked for by its id from another workspace, a record's report is not found.
          assert.equal(
            (await db.transaction((tx) => deliveriesOf(tx, b.workspaceId, "message", [message.id]))).size,
            0,
          );
          // In b's scope, as a request of b's would be: a's report is not there to read or change, a
          // report cannot be written for a, and the reports as they arrive are no workspace's to read.
          const inB = <T>(run: () => Promise<T>) => runInWorkspaceScope(b.workspaceId, run);
          const refusal = (pattern: RegExp) => (error: Error) =>
            pattern.test(String((error as { cause?: Error }).cause?.message ?? error.message));
          assert.deepEqual(await inB(async () => await db.select().from(valoMessageDeliveries)), []);
          assert.equal(
            (
              await inB(
                async () =>
                  await db
                    .update(valoMessageDeliveries)
                    .set({ delivery: "bounced" })
                    .where(eq(valoMessageDeliveries.recordId, message.id))
                    .returning(),
              )
            ).length,
            0,
          );
          await assert.rejects(
            inB(
              async () =>
                await db.insert(valoMessageDeliveries).values({
                  id: randomUUID(),
                  workspaceId: a.workspaceId,
                  source: "message",
                  recordId: randomUUID(),
                  delivery: "delivered",
                  reportedAt: new Date(),
                }),
            ),
            refusal(/row-level security policy/),
          );
          await assert.rejects(
            inB(async () => await db.select().from(valoEmailEvents)),
            refusal(/permission denied for table valo_email_events/),
          );
          assert.equal((await deliveryOf("message", message.id))!.delivery, "delivered");
          const own = (await workspaceDataExport(a)).data.messageDeliveries as Record<string, unknown>[];
          assert.equal(own.length, 1);
          assert.deepEqual(Object.keys(own[0]!).sort(), [
            "delivery",
            "detail",
            "recordId",
            "reportedAt",
            "source",
            "updatedAt",
          ]);
          assert.deepEqual(
            [own[0]!.source, own[0]!.recordId, own[0]!.delivery],
            ["message", message.id, "delivered"],
          );
          assert.deepEqual((await workspaceDataExport(b)).data.messageDeliveries, []);
        },
      );

      await t.test(
        "a settled report is removed thirty days on, and what it said stays on the record",
        async () => {
          const a = await workspace();
          const message = await taken(a);
          const old = await report("delivered", message.reference, { occurredAt: at(2) });
          const recent = await report("delayed", message.reference, { occurredAt: at(3) });
          const waiting = await report("delivered", randomUUID());
          await recordDeliveryReports();
          const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000);
          await db
            .update(valoEmailEvents)
            .set({ settledAt: days(31), receivedAt: days(31) })
            .where(eq(valoEmailEvents.eventKey, old.eventKey));
          await db
            .update(valoEmailEvents)
            .set({ settledAt: days(29), receivedAt: days(29) })
            .where(eq(valoEmailEvents.eventKey, recent.eventKey));
          await recordDeliveryReports();
          assert.equal(await eventOf(old.eventKey), undefined);
          assert.equal((await eventOf(recent.eventKey))!.status, "applied");
          assert.equal((await eventOf(waiting.eventKey))!.status, "pending");
          assert.equal((await entry(a, message.id)).delivery, "delivered");
        },
      );

      await t.test(
        "the worker's task offers what is due and records what was reported, and a failure of one part does not stop the other",
        async () => {
          const a = await workspace();
          const first = await taken(a);
          const { message: due } = await settled(a);
          const reported = await report("delivered", first.reference);
          const ran = await runMessagesJob(standInSender(), new Date(), { workspaceId: a.workspaceId });
          assert.deepEqual([ran.checked, ran.offered], [1, 1]);
          // The task gives back what its recording did. Another test file records reports too, and may
          // have recorded this one first, so the report's own state below is the fact, not the count.
          assert.ok(ran.reports);
          assert.equal((await row(due.id)).status, "accepted");
          assert.equal((await eventOf(reported.eventKey))!.status, "applied");
          // The messages cannot be offered: the task fails, and the report is recorded all the same.
          const second = await report("complained", first.reference);
          await assert.rejects(
            runMessagesJob(
              standInSender(),
              new Date(),
              { workspaceId: a.workspaceId },
              {
                offer: async () => {
                  throw Error("SYNTHETIC_OFFER_FAILURE");
                },
                record: recordDeliveryReports,
              },
            ),
            /MESSAGES_JOB_PARTIALLY_FAILED/,
          );
          assert.equal((await eventOf(second.eventKey))!.status, "applied");
          assert.equal((await entry(a, first.id)).delivery, "complained");
        },
      );

      await t.test(
        "where the delivery tables are not there yet, no report is read or kept, and the log still lists its messages",
        async () => {
          const a = await workspace();
          const message = await taken(a);
          await db.transaction(async (tx) => {
            // As a database is before the delivery migration reaches it: no such tables by the names a
            // query finds them under. This transaction alone looks where they are not.
            await tx.execute(sql`set local search_path to pg_catalog`);
            assert.equal(await emailEventsReady(tx), false);
            assert.equal((await deliveriesOf(tx, a.workspaceId, "message", [message.id])).size, 0);
            // Nothing failed in the transaction, so a reader's own work would still commit.
            assert.deepEqual((await tx.execute(sql`select 1 as ok`)).rows, [{ ok: 1 }]);
          });
          assert.equal(await emailEventsReady(db), true);
          assert.equal((await entry(a, message.id)).status, "accepted");
        },
      );
    } finally {
      guard.restore();
      await restorePause();
      // This test's own reports, whatever became of them.
      if (made.length) await db.delete(valoEmailEvents).where(inArray(valoEmailEvents.eventKey, made));
      await pool.end();
    }
  },
);
