import type { PgBoss } from "pg-boss";
import { z } from "zod";

/**
 * The background tasks the development worker runs once a minute. Each runs as its own scheduled
 * queue job, so one failing or slow task never stops another, a failed run stays visible as a
 * failed job, and with several workers each task still runs once a minute in all.
 */
export const OPERATIONS_QUEUE = "valo-operations-v1";
export const OPERATIONAL_DOMAINS = [
  "sources",
  "reminders",
  "paymentEvents",
  "refunds",
  "disputes",
  "disputeActions",
  "paymentReconciliation",
] as const;
export type OperationalDomain = (typeof OPERATIONAL_DOMAINS)[number];
/**
 * `stately` with each domain's name as the singleton key allows at most one queued and one active
 * job per domain: a slow run never piles up behind itself. There are no retries, because the next
 * minute's job runs the task again; a run that hangs expires after five minutes.
 */
export const OPERATIONS_QUEUE_OPTIONS = { policy: "stately", retryLimit: 0, expireInSeconds: 300 } as const;
export const OPERATIONS_CRON = "* * * * *";
const operationalJob = z.object({ domain: z.enum(OPERATIONAL_DOMAINS) }).strict();

/** Reviewed development setup only (queue-migration.ts): the queue and one schedule per domain. */
export async function installOperationsQueue(boss: Pick<PgBoss, "createQueue" | "schedule">) {
  await boss.createQueue(OPERATIONS_QUEUE, { ...OPERATIONS_QUEUE_OPTIONS });
  for (const domain of OPERATIONAL_DOMAINS)
    await boss.schedule(OPERATIONS_QUEUE, OPERATIONS_CRON, { domain }, { key: domain, singletonKey: domain });
}

/**
 * Runs one scheduled job's task. The outcome is recorded for the worker's health; a failure is
 * then rethrown, so the queue keeps the job as failed. Other domains' jobs are unaffected.
 */
export function operationalJobRunner(
  runners: Record<OperationalDomain, () => Promise<unknown>>,
  record: (domain: OperationalDomain, healthy: boolean) => void,
) {
  return async (data: unknown) => {
    const { domain } = operationalJob.parse(data);
    try {
      await runners[domain]();
    } catch (error) {
      record(domain, false);
      throw error;
    }
    record(domain, true);
  };
}

/** The worker is healthy only while every domain's latest run succeeded. */
export function operationsHealthy(latest: ReadonlyMap<OperationalDomain, boolean>) {
  return [...latest.values()].every(Boolean);
}
