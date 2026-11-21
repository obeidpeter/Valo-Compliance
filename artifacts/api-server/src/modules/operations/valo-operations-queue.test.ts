import test from "node:test";
import assert from "node:assert/strict";
import {
  OPERATIONAL_DOMAINS,
  OPERATIONS_CRON,
  OPERATIONS_QUEUE,
  installOperationsQueue,
  operationalJobRunner,
  operationsHealthy,
  type OperationalDomain,
} from "./valo-operations-queue";

const runners = (overrides: Partial<Record<OperationalDomain, () => Promise<unknown>>> = {}) => {
  const called: OperationalDomain[] = [];
  const all = Object.fromEntries(
    OPERATIONAL_DOMAINS.map((domain) => [
      domain,
      overrides[domain] ??
        (async () => {
          called.push(domain);
        }),
    ]),
  ) as Record<OperationalDomain, () => Promise<unknown>>;
  return { all, called };
};

test("failed or waiting reminders cannot stop payment events, refunds or reconciliation", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { all, called } = runners({
    reminders: async () => {
      await waiting;
      throw Error("CONTROLLED_REMINDER_FAILURE");
    },
  });
  const health = new Map<OperationalDomain, boolean>();
  const run = operationalJobRunner(all, (domain, healthy) => health.set(domain, healthy));
  // Each domain is its own job: the waiting reminder holds back no other domain's job.
  const reminder = run({ domain: "reminders" });
  for (const domain of OPERATIONAL_DOMAINS.filter((d) => d !== "reminders")) await run({ domain });
  assert.deepEqual(
    called,
    OPERATIONAL_DOMAINS.filter((d) => d !== "reminders"),
  );
  assert.equal(operationsHealthy(health), true);
  release();
  // The failure reaches the queue, which keeps the job as failed, and marks the worker unhealthy.
  await assert.rejects(reminder, /CONTROLLED_REMINDER_FAILURE/);
  assert.equal(health.get("reminders"), false);
  assert.equal(operationsHealthy(health), false);
  // The next successful run of the domain restores health.
  const recovered = operationalJobRunner(runners().all, (domain, healthy) => health.set(domain, healthy));
  await recovered({ domain: "reminders" });
  assert.equal(operationsHealthy(health), true);
});

test("a job naming no known task runs nothing", async () => {
  const { all, called } = runners();
  const recorded: string[] = [];
  const run = operationalJobRunner(all, (domain) => recorded.push(domain));
  for (const data of [{ domain: "everything" }, {}, { domain: "refunds", extra: true }, null])
    await assert.rejects(run(data), { name: "ZodError" }, JSON.stringify(data));
  assert.deepEqual([called, recorded], [[], []]);
});

test("the reviewed setup installs one stately queue and an every-minute schedule per task", async () => {
  const calls: unknown[][] = [];
  await installOperationsQueue({
    createQueue: async (...args: unknown[]) => {
      calls.push(["createQueue", ...args]);
    },
    schedule: async (...args: unknown[]) => {
      calls.push(["schedule", ...args]);
    },
  } as unknown as Parameters<typeof installOperationsQueue>[0]);
  assert.deepEqual(calls, [
    ["createQueue", OPERATIONS_QUEUE, { policy: "stately", retryLimit: 0, expireInSeconds: 300 }],
    ...OPERATIONAL_DOMAINS.map((domain) => [
      "schedule",
      OPERATIONS_QUEUE,
      OPERATIONS_CRON,
      { domain },
      { key: domain, singletonKey: domain },
    ]),
  ]);
  assert.equal(OPERATIONS_CRON, "* * * * *");
});
