import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  valoReminderOutbox,
  valoReminderPreferences,
  valoTasks,
  valoEvents,
  valoMemberships,
  valoWorkspaces,
} from "@workspace/db";
import { resolveWorkspace } from "./valo-store";
import { createTask, saveReminderPreferences, reminderInstant } from "./valo-tasks";
import { processReminder, reminderRetryAt, reconcileDueReminders } from "./valo-reminder-worker";
test(
  "durable reminder delivery controls; controlled transport, not real email",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const actor = await resolveWorkspace(`synthetic-reminder-delivery-${randomUUID()}`);
    const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      now = new Date(+reminderInstant(due, 1) + 1);
    const row = async (id: string) =>
      (await db.select().from(valoReminderOutbox).where(eq(valoReminderOutbox.id, id)))[0]!;
    async function fresh() {
      const task = await createTask(actor, {
        title: "Controlled reminder probe",
        notes: "Synthetic only",
        dueDate: due,
        dateConfirmed: true,
        assessmentId: null,
        ruleId: null,
      });
      return (await db.select().from(valoReminderOutbox).where(eq(valoReminderOutbox.taskId, task.id)))[0]!;
    }
    try {
      await saveReminderPreferences(actor, { enabled: true, offsets: [1], expectedRevision: 0 });
      await t.test("turning reminders off needs no selected offset and cancels before dispatch", async () => {
        const prefs = (
          await db
            .select()
            .from(valoReminderPreferences)
            .where(eq(valoReminderPreferences.workspaceId, actor.workspaceId))
        )[0];
        await saveReminderPreferences(actor, {
          enabled: false,
          offsets: [],
          expectedRevision: prefs.revision,
        });
        const off = (
          await db
            .select()
            .from(valoReminderPreferences)
            .where(eq(valoReminderPreferences.workspaceId, actor.workspaceId))
        )[0];
        assert.equal(off.enabled, false);
        assert.deepEqual(off.offsets, []);
        await assert.rejects(
          saveReminderPreferences(actor, { enabled: true, offsets: [], expectedRevision: off.revision }),
        );
        await saveReminderPreferences(actor, { enabled: true, offsets: [1], expectedRevision: off.revision });
      });
      await t.test("twenty-five held source reminders cannot starve an eligible later reminder", async () => {
        const ids: string[] = [];
        for (let i = 0; i < 26; i++) {
          const taskId = randomUUID(),
            id = (i === 25 ? "ffffffff" : "00000000") + randomUUID().slice(8);
          ids.push(id);
          await db.insert(valoTasks).values({
            id: taskId,
            workspaceId: actor.workspaceId,
            actorId: actor.identityId,
            title: "Controlled fairness fixture",
            notes: "",
            dueDate: due,
            dateConfirmed: true,
            ruleId: i < 25 ? "controlled-unreleased-rule" : null,
            ruleVersion: i < 25 ? 1 : null,
          });
          await db.insert(valoReminderOutbox).values({
            id,
            workspaceId: actor.workspaceId,
            taskId,
            idempotencyKey: `${taskId}/${due}/1`,
            scheduledAt: reminderInstant(due, 1),
            status: "pending",
          });
        }
        let calls = 0;
        const sender = {
          send: async () => {
            calls++;
            return { providerMessageId: "controlled-fair-ack" };
          },
        };
        const first = await reconcileDueReminders(sender, { workspaceId: actor.workspaceId }, now);
        assert.equal(first.checked, 25);
        assert.equal(calls, 0);
        assert.equal((await row(ids[0])).status, "held");
        assert.ok((await row(ids[0])).nextAttemptAt! > now);
        const second = await reconcileDueReminders(sender, { workspaceId: actor.workspaceId }, now);
        assert.equal(second.checked, 1);
        assert.equal(calls, 1);
        assert.equal((await row(ids[25])).status, "sent");
        assert.equal((await row(ids[25])).deliveredAt, null);
      });
      await t.test("no configured provider holds the reminder and consumes no attempt", async () => {
        const r = await fresh();
        assert.equal(await processReminder(actor.workspaceId, r.id, null, now), "held");
        assert.equal((await row(r.id)).attempts, 0);
        assert.equal((await row(r.id)).deliveredAt, null);
      });
      await t.test("parallel scheduler invocations send once; acceptance is not inbox delivery", async () => {
        const r = await fresh();
        let calls = 0;
        const sender = {
          send: async () => {
            calls++;
            return { providerMessageId: "controlled-ack" };
          },
        };
        await Promise.all([
          processReminder(actor.workspaceId, r.id, sender, now),
          processReminder(actor.workspaceId, r.id, sender, now),
        ]);
        const saved = await row(r.id);
        assert.equal(calls, 1);
        assert.equal(saved.attempts, 1);
        assert.equal(saved.status, "sent");
        assert.equal(saved.deliveredAt, null);
        assert.equal(saved.leaseToken, null);
      });
      await t.test(
        "failed acceptance persists its attempt and waits; retry keeps the same message reference",
        async () => {
          const r = await fresh(),
            keys: string[] = [];
          let calls = 0;
          const sender = {
            send: async (input: { idempotencyKey: string }) => {
              calls++;
              keys.push(input.idempotencyKey);
              if (calls === 1) throw Error("CONTROLLED_UNAVAILABLE");
              return { providerMessageId: "controlled-retry-ack" };
            },
          };
          assert.equal(await processReminder(actor.workspaceId, r.id, sender, now), "failed");
          const failed = await row(r.id);
          assert.equal(failed.attempts, 1);
          assert.equal(+failed.nextAttemptAt!, +now + 60000);
          await processReminder(actor.workspaceId, r.id, sender, new Date(+now + 30000));
          assert.equal(calls, 1);
          assert.equal(await processReminder(actor.workspaceId, r.id, sender, failed.nextAttemptAt!), "sent");
          assert.equal(calls, 2);
          assert.equal(keys[0], keys[1]);
          assert.equal((await row(r.id)).scheduledAt.toISOString(), r.scheduledAt.toISOString());
        },
      );
      await t.test("five failed attempts remain bounded even with repeated scheduler runs", async () => {
        const r = await fresh();
        let calls = 0,
          at = now;
        const sender = {
          send: async () => {
            calls++;
            throw Error("CONTROLLED_UNAVAILABLE");
          },
        };
        for (let n = 1; n <= 5; n++) {
          assert.equal(await processReminder(actor.workspaceId, r.id, sender, at), "failed");
          const saved = await row(r.id);
          assert.equal(saved.attempts, n);
          at = saved.nextAttemptAt ?? new Date(+at + 86400000);
        }
        for (let n = 0; n < 3; n++) await processReminder(actor.workspaceId, r.id, sender, at);
        const saved = await row(r.id);
        assert.equal(calls, 5);
        assert.equal(saved.nextAttemptAt, null);
        assert.equal(saved.reason, "EMAIL_ATTEMPT_LIMIT_REACHED");
        assert.equal(saved.deliveredAt, null);
        assert.equal(reminderRetryAt(5, now), null);
      });
      await t.test(
        "SIGKILL during dispatch preserves the claim; expiry recovers without losing the attempt",
        async () => {
          const r = await fresh();
          const source = `import {processReminder} from './src/lib/valo-reminder-worker.ts';
        await processReminder(${JSON.stringify(actor.workspaceId)},${JSON.stringify(r.id)},
          {send:async()=>{process.send({phase:'controlled_adapter_entered'});return new Promise(()=>{});}},
          new Date(${JSON.stringify(now.toISOString())}));`;
          const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          });
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(Error("CONTROLLED_CHILD_TIMEOUT")), 15000);
              child.once("message", () => {
                clearTimeout(timer);
                resolve();
              });
              child.once("exit", () => {
                clearTimeout(timer);
                reject(Error("CONTROLLED_CHILD_EXITED_EARLY"));
              });
            });
            const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
            child.kill("SIGKILL");
            await closed;
            const abandoned = await row(r.id);
            assert.equal(abandoned.attempts, 1);
            assert.ok(abandoned.leaseToken);
            let calls = 0;
            const sender = {
              send: async (input: { idempotencyKey: string }) => {
                calls++;
                assert.equal(input.idempotencyKey, r.idempotencyKey);
                return { providerMessageId: "controlled-recovery-ack" };
              },
            };
            await processReminder(actor.workspaceId, r.id, sender, new Date(+now + 10000));
            assert.equal(calls, 0);
            assert.equal(
              await processReminder(actor.workspaceId, r.id, sender, new Date(+now + 31000)),
              "sent",
            );
            assert.equal(calls, 1);
            assert.equal((await row(r.id)).attempts, 2);
            assert.equal((await row(r.id)).deliveredAt, null);
          } finally {
            child.kill("SIGKILL");
          }
        },
      );
      await t.test(
        "abandoned final attempt becomes visibly failed instead of permanently running",
        async () => {
          const r = await fresh();
          await db
            .update(valoReminderOutbox)
            .set({
              status: "pending",
              attempts: 5,
              leaseToken: randomUUID(),
              leaseUntil: new Date(+now - 1),
              nextAttemptAt: new Date(+now - 1),
            })
            .where(eq(valoReminderOutbox.id, r.id));
          let calls = 0;
          const status = await processReminder(
            actor.workspaceId,
            r.id,
            {
              send: async () => {
                calls++;
                return { providerMessageId: "must-not-call" };
              },
            },
            now,
          );
          assert.equal(status, "failed");
          assert.equal(calls, 0);
          assert.equal((await row(r.id)).leaseToken, null);
          assert.equal((await row(r.id)).reason, "EMAIL_ATTEMPT_LIMIT_REACHED");
        },
      );
      await t.test(
        "expired or unknown first acceptance time holds before any new provider invocation",
        async () => {
          for (const [firstAttemptAt, reason] of [
            [new Date(+now - 24 * 60 * 60 * 1000), "EMAIL_REPLAY_WINDOW_EXPIRED"],
            [null, "EMAIL_FIRST_ATTEMPT_UNKNOWN"],
            [new Date(+now + 60000), "EMAIL_FIRST_ATTEMPT_UNKNOWN"],
          ] as const) {
            const r = await fresh();
            let calls = 0;
            await db
              .update(valoReminderOutbox)
              .set({ status: "failed", attempts: 1, firstAttemptAt, nextAttemptAt: null })
              .where(eq(valoReminderOutbox.id, r.id));
            const sender = {
              replayWindowMs: 23 * 60 * 60 * 1000,
              send: async () => {
                calls++;
                return { providerMessageId: "must-not-send" };
              },
            };
            assert.equal(await processReminder(actor.workspaceId, r.id, sender, now), "held");
            const held = await row(r.id);
            assert.equal(calls, 0);
            assert.equal(held.attempts, 1);
            assert.equal(held.reason, reason);
            assert.equal(held.deliveredAt, null);
          }
        },
      );
      await t.test("opt-out before dispatch cancels failed work without sending", async () => {
        const r = await fresh();
        await processReminder(
          actor.workspaceId,
          r.id,
          {
            send: async () => {
              throw Error("CONTROLLED_UNAVAILABLE");
            },
          },
          now,
        );
        const current = (
          await db
            .select()
            .from(valoReminderPreferences)
            .where(eq(valoReminderPreferences.workspaceId, actor.workspaceId))
        )[0];
        await saveReminderPreferences(actor, {
          enabled: false,
          offsets: [1],
          expectedRevision: current.revision,
        });
        let calls = 0;
        assert.equal(
          await processReminder(
            actor.workspaceId,
            r.id,
            {
              send: async () => {
                calls++;
                return { providerMessageId: "must-not-call" };
              },
            },
            new Date(+now + 120000),
          ),
          "cancelled",
        );
        assert.equal(calls, 0);
        assert.equal((await row(r.id)).nextAttemptAt, null);
      });
    } finally {
      await db.delete(valoReminderOutbox).where(eq(valoReminderOutbox.workspaceId, actor.workspaceId));
      await db
        .delete(valoReminderPreferences)
        .where(eq(valoReminderPreferences.workspaceId, actor.workspaceId));
      await db.delete(valoTasks).where(eq(valoTasks.workspaceId, actor.workspaceId));
      await db.delete(valoEvents).where(eq(valoEvents.workspaceId, actor.workspaceId));
      await db.delete(valoMemberships).where(eq(valoMemberships.workspaceId, actor.workspaceId));
      await db.delete(valoWorkspaces).where(eq(valoWorkspaces.id, actor.workspaceId));
      await pool.end();
    }
  },
);
