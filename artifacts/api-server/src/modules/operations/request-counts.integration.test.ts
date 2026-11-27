import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool, valoMessages, valoReminderOutbox, valoRequestMinutes, valoTasks } from "@workspace/db";
import { collectOperationalSample, readinessQueries } from "./valo-operations";
import { RequestCounts, removeOldRequestMinutes, writeRequestMinutes } from "./request-counts";
import { EXPORT_QUEUE } from "../exports";
import { resolveWorkspace } from "../workspaces";

/**
 * NFR-003, NFR-010 (docs/architecture/alerts.md, part 3), on a real database: each process's request
 * counts add up by the minute, the table refuses counts that do not hold together, the readings take the
 * last ten minutes' counts, a week of minutes is kept, and the readings of reminders, the job queue and
 * messages count real rows. Every row is synthetic.
 */
const MINUTE = 60_000;
const query = (text: string, values: unknown[]) => pool.query(text, values);
/** The start of the minute `ago` minutes before now. */
const minuteAgo = (ago: number) => {
  const now = Date.now();
  return now - (now % MINUTE) - ago * MINUTE;
};
const reading = async (name: keyof typeof readinessQueries) =>
  Number((await pool.query<{ value: number }>(readinessQueries[name])).rows[0]?.value);
/** One process's counts for a minute: `requests` requests, `failures` of them failing, each taking `ms`. */
function counted(minute: number, requests: number, failures: number, ms: number) {
  const counts = new RequestCounts();
  for (let n = 0; n < requests; n++) counts.count(minute + n, ms, n < failures);
  return counts.take(minute + MINUTE);
}
/** The database's refusal, under the driver's wrapper. */
const refusedBy = (words: RegExp) => (error: unknown) =>
  words.test(String((error as { cause?: Error }).cause?.message ?? (error as Error).message));

test(
  "request counts: each process's minutes add up, the readings take the last ten minutes, a week is kept, and reminders and jobs are read from their own tables",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async (t) => {
    // The table holds counts alone; this test's recent minutes start from nothing.
    await pool.query(
      "DELETE FROM valo_request_minutes WHERE minute >= date_trunc('minute', now()) - interval '15 minutes'",
    );
    try {
      await t.test(
        "two processes' counts for one minute add up, and counts that do not hold together are refused",
        async () => {
          const minute = minuteAgo(3);
          // One process: 150 requests, 3 of them failing, each taking 700 ms. Another: 50, each taking 80 ms.
          await writeRequestMinutes(counted(minute, 150, 3, 700), query);
          await writeRequestMinutes(counted(minute, 50, 0, 80), query);
          const [row] = await db
            .select()
            .from(valoRequestMinutes)
            .where(eq(valoRequestMinutes.minute, new Date(minute)));
          assert.deepEqual(
            [row?.requests, row?.failures, row?.within100ms, row?.within500ms, row?.within1s, row?.within10s],
            [200, 3, 50, 50, 200, 200],
          );
          const insert = (minuteAt: string, requests: number, failures: number, within: number[]) =>
            pool.query(
              `INSERT INTO valo_request_minutes (minute, requests, failures, within_100ms, within_250ms, within_500ms,
               within_1s, within_2500ms, within_5s, within_10s) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [minuteAt, requests, failures, ...within],
            );
          const later = new Date(minuteAgo(4));
          await assert.rejects(
            insert(new Date(later.getTime() + 1500).toISOString(), 1, 0, [1, 1, 1, 1, 1, 1, 1]),
            refusedBy(/valo_request_minutes_minute_check/),
          );
          await assert.rejects(
            insert(later.toISOString(), 1, 2, [1, 1, 1, 1, 1, 1, 1]),
            refusedBy(/valo_request_minutes_counts_check/),
          );
          // Each count holds every shorter one.
          await assert.rejects(
            insert(later.toISOString(), 2, 0, [2, 1, 2, 2, 2, 2, 2]),
            refusedBy(/valo_request_minutes_counts_check/),
          );
        },
      );
      await t.test(
        "the readings take the last ten minutes, and fewer than a hundred requests read as nothing",
        async () => {
          // 200 requests, 3 failing: 15 in 1,000. 95 in 100 took at most 1 second.
          assert.equal(await reading("requestFailures"), 15);
          assert.equal(await reading("requestTime"), 1000);
          // Slower requests a minute later: 20 more, taking 3 seconds, bring the 95th in 100 to 5 seconds.
          await writeRequestMinutes(counted(minuteAgo(2), 20, 0, 3000), query);
          assert.equal(await reading("requestTime"), 5000);
          // Counts older than ten minutes are left out.
          await writeRequestMinutes(counted(minuteAgo(12), 1000, 1000, 20000), query);
          assert.equal(await reading("requestFailures"), Math.floor((1000 * 3) / 220));
          // The worker's sample reads them as its readings.
          const sample = await collectOperationalSample((text) => pool.query(text));
          assert.deepEqual(
            [sample.requestFailures.value, sample.requestTime.value],
            [Math.floor((1000 * 3) / 220), 5000],
          );
          await pool.query(
            "DELETE FROM valo_request_minutes WHERE minute >= date_trunc('minute', now()) - interval '10 minutes'",
          );
          await writeRequestMinutes(counted(minuteAgo(1), 99, 99, 20000), query);
          assert.deepEqual([await reading("requestFailures"), await reading("requestTime")], [0, 0]);
        },
      );
      await t.test("minutes older than a week are removed and newer ones kept", async () => {
        const old = minuteAgo(8 * 24 * 60),
          recent = minuteAgo(5);
        await writeRequestMinutes([...counted(old, 1, 0, 10), ...counted(recent, 1, 0, 10)], query);
        await removeOldRequestMinutes(query);
        const kept = await db
          .select({ minute: valoRequestMinutes.minute })
          .from(valoRequestMinutes)
          .where(inArray(valoRequestMinutes.minute, [new Date(old), new Date(recent)]));
        assert.deepEqual(
          kept.map((row) => row.minute.getTime()),
          [recent],
        );
      });
      await t.test(
        "reminders pending past their time and jobs waiting past their start are counted from their tables",
        async () => {
          const actor = await resolveWorkspace(`synthetic-alert-readings-${randomUUID()}`);
          const taskId = randomUUID(),
            reminderId = randomUUID();
          await db.insert(valoTasks).values({
            id: taskId,
            workspaceId: actor.workspaceId,
            actorId: actor.identityId,
            title: "Synthetic: a task whose reminder waits",
            notes: "",
            dueDate: "2026-11-20",
            dateConfirmed: true,
          });
          const before = await reading("reminders");
          await db.insert(valoReminderOutbox).values({
            id: reminderId,
            workspaceId: actor.workspaceId,
            taskId,
            idempotencyKey: `${taskId}/2026-11-20/1`,
            scheduledAt: new Date(Date.now() - 20 * MINUTE),
            status: "pending",
          });
          assert.equal(await reading("reminders"), before + 1);
          // A retry not yet due is not waiting past its time, and neither is a held reminder.
          await db
            .update(valoReminderOutbox)
            .set({ nextAttemptAt: new Date(Date.now() + 5 * MINUTE) })
            .where(eq(valoReminderOutbox.id, reminderId));
          assert.equal(await reading("reminders"), before);
          await db
            .update(valoReminderOutbox)
            .set({ nextAttemptAt: null, status: "held" })
            .where(eq(valoReminderOutbox.id, reminderId));
          assert.equal(await reading("reminders"), before);

          const waiting = await reading("jobQueue");
          const job = await pool.query<{ id: string }>(
            "INSERT INTO valo_jobs.job (name, data, start_after) VALUES ($1, '{}', now() - interval '20 minutes') RETURNING id",
            [EXPORT_QUEUE],
          );
          try {
            assert.equal(await reading("jobQueue"), waiting + 1);
            await pool.query("UPDATE valo_jobs.job SET start_after = now() WHERE id = $1", [job.rows[0]!.id]);
            assert.equal(await reading("jobQueue"), waiting);
          } finally {
            await pool.query("DELETE FROM valo_jobs.job WHERE id = $1", [job.rows[0]!.id]);
          }
        },
      );
      // docs/architecture/messages.md, part 1: a message waiting past its time, and one that failed.
      await t.test(
        "messages waiting past their time, and messages that failed in the last day, are counted from their table",
        async () => {
          const actor = await resolveWorkspace(`synthetic-alert-readings-${randomUUID()}`);
          const id = randomUUID();
          const set = (values: Partial<typeof valoMessages.$inferInsert>) =>
            db.update(valoMessages).set(values).where(eq(valoMessages.id, id));
          const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE);
          const [waiting, failed] = [await reading("messages"), await reading("failedMessages")];
          try {
            // Queued twenty minutes ago and never offered: nothing is taking the messages.
            await db.insert(valoMessages).values({
              id,
              workspaceId: actor.workspaceId,
              kind: "purchase_receipt",
              class: "necessary",
              recipientIdentityId: actor.identityId,
              subjectId: randomUUID(),
              createdAt: ago(20),
            });
            assert.equal(await reading("messages"), waiting + 1);
            // A retry not yet due is not waiting past its time, and neither is a message held on purpose.
            await set({ nextAttemptAt: new Date(Date.now() + 5 * MINUTE) });
            assert.equal(await reading("messages"), waiting);
            await set({ status: "held", reason: "MESSAGES_PAUSED", nextAttemptAt: ago(30) });
            assert.equal(await reading("messages"), waiting);
            // An attempt whose lease ended twenty minutes ago, with no result recorded since, is waiting.
            const attempted = { attempts: 1, firstAttemptAt: ago(21), lastAttemptAt: ago(21) };
            await set({
              status: "sending",
              reason: null,
              nextAttemptAt: null,
              ...attempted,
              leaseToken: randomUUID(),
              leaseUntil: ago(20),
            });
            assert.equal(await reading("messages"), waiting + 1);
            // One still inside its lease is being sent, not waiting.
            await set({ leaseUntil: new Date(Date.now() + MINUTE / 2) });
            assert.equal(await reading("messages"), waiting);
            // Failed now: counted for a day, and as failed, not as waiting.
            await set({
              status: "failed",
              reason: "ATTEMPT_LIMIT_REACHED",
              leaseToken: null,
              leaseUntil: null,
              updatedAt: new Date(),
            });
            assert.deepEqual(
              [await reading("messages"), await reading("failedMessages")],
              [waiting, failed + 1],
            );
            await set({ updatedAt: ago(25 * 60) });
            assert.equal(await reading("failedMessages"), failed);
            // A message a sender took is neither.
            await set({
              status: "accepted",
              reason: null,
              sender: "stand-in",
              providerMessageId: "stand-in-synthetic",
              acceptedAt: new Date(),
              updatedAt: new Date(),
            });
            assert.deepEqual([await reading("messages"), await reading("failedMessages")], [waiting, failed]);
          } finally {
            await db.delete(valoMessages).where(eq(valoMessages.id, id));
          }
        },
      );
    } finally {
      await pool.query(
        "DELETE FROM valo_request_minutes WHERE minute >= date_trunc('minute', now()) - interval '15 minutes'",
      );
      await pool.end();
    }
  },
);
