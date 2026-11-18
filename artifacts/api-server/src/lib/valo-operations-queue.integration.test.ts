import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { exportQueue } from "../modules/exports/valo-export-queue";
import {
  OPERATIONAL_DOMAINS,
  OPERATIONS_CRON,
  OPERATIONS_QUEUE,
  OPERATIONS_QUEUE_OPTIONS,
  operationalJobRunner,
  type OperationalDomain,
} from "./valo-operations-queue";

// The scheduled operations queue in a disposable database, after the reviewed development queue
// setup ran (an earlier CI step). Behaviour is shown on a temporary queue with the same options,
// so the jobs the schedules create cannot interfere. No task here touches a real domain.
test(
  "each operational task is its own scheduled job: one queued per task, and a failing or waiting task holds back no other",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    // The reviewed setup left the queue and one every-minute schedule per task.
    const [queue] = (
      await pool.query("SELECT policy,retry_limit,expire_seconds FROM valo_jobs.queue WHERE name=$1", [
        OPERATIONS_QUEUE,
      ])
    ).rows;
    assert.deepEqual(queue, {
      policy: OPERATIONS_QUEUE_OPTIONS.policy,
      retry_limit: OPERATIONS_QUEUE_OPTIONS.retryLimit,
      expire_seconds: OPERATIONS_QUEUE_OPTIONS.expireInSeconds,
    });
    const schedules = (
      await pool.query(
        "SELECT key,cron,data,options->>'singletonKey' AS singleton FROM valo_jobs.schedule WHERE name=$1 ORDER BY key",
        [OPERATIONS_QUEUE],
      )
    ).rows;
    assert.deepEqual(
      schedules,
      [...OPERATIONAL_DOMAINS].sort().map((domain) => ({
        key: domain,
        cron: OPERATIONS_CRON,
        data: { domain },
        singleton: domain,
      })),
    );

    const boss = exportQueue();
    boss.on("error", () => assert.fail("queue database error"));
    const name = `valo-operations-test-${randomUUID()}`;
    await boss.start();
    try {
      await boss.createQueue(name, { ...OPERATIONS_QUEUE_OPTIONS });
      const send = (domain: OperationalDomain) => boss.send(name, { domain }, { singletonKey: domain });
      // One queued job per task: a second one for the same task is refused, another task's is not.
      const first = await send("reminders");
      assert.ok(first);
      assert.equal(await send("reminders"), null);
      for (const domain of OPERATIONAL_DOMAINS.filter((d) => d !== "reminders"))
        assert.ok(await send(domain));

      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const health = new Map<OperationalDomain, boolean>();
      const runners = Object.fromEntries(
        OPERATIONAL_DOMAINS.map((domain) => [domain, async () => {}]),
      ) as Record<OperationalDomain, () => Promise<unknown>>;
      runners.reminders = () => waiting;
      runners.refunds = async () => {
        throw Error("CONTROLLED_REFUND_FAILURE");
      };
      const run = operationalJobRunner(runners, (domain, healthy) => health.set(domain, healthy));
      await boss.work(
        name,
        { batchSize: 1, localConcurrency: OPERATIONAL_DOMAINS.length, pollingIntervalSeconds: 0.5 },
        async (jobs) => {
          for (const job of jobs) await run(job.data);
        },
      );
      const states = async () =>
        Object.fromEntries(
          (
            await pool.query("SELECT data->>'domain' AS domain,state FROM valo_jobs.job WHERE name=$1", [
              name,
            ])
          ).rows.map((r) => [r.domain, r.state]),
        );
      const until = async (done: (s: Record<string, string>) => boolean) => {
        for (let i = 0; i < 100; i++) {
          const s = await states();
          if (done(s)) return s;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return states();
      };
      // While the reminder task waits, every other task finishes; the failing one is kept as failed.
      const others = OPERATIONAL_DOMAINS.filter((d) => d !== "reminders");
      const meanwhile = await until((s) => others.every((d) => ["completed", "failed"].includes(s[d]!)));
      assert.deepEqual(meanwhile, {
        ...Object.fromEntries(others.map((d) => [d, d === "refunds" ? "failed" : "completed"])),
        reminders: "active",
      });
      assert.equal(health.get("refunds"), false);
      release();
      assert.equal((await until((s) => s.reminders === "completed")).reminders, "completed");
      assert.equal(health.get("reminders"), true);
    } finally {
      await boss.offWork(name).catch(() => {
        // The worker may not have started; deleting the queue below is what cleans up.
      });
      await boss.deleteQueue(name);
      await boss.stop({ graceful: false });
    }
  },
);
