import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { quotaPolicy, type QuotaBucket, type QuotaDecision } from "./valo-quota-policy";
export { quotaPolicy, quotaSubjectHash } from "./valo-quota-policy";

/** One DB-clock window across processes; no per-process in-memory fallback. */
export async function consumeQuota(bucket: QuotaBucket, subjectHash: string, limit: number = quotaPolicy[bucket],
  window:"minute"|"day"="minute",executor:Pick<typeof db,"execute">=db): Promise<QuotaDecision> {
  if (!Object.hasOwn(quotaPolicy, bucket) || !/^[a-f0-9]{64}$/.test(subjectHash) ||
      !Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error("InvalidQuotaConfiguration");
  if(!["minute","day"].includes(window))throw new Error("InvalidQuotaConfiguration");
  const duration=window==="day"?sql`interval '1 day'`:sql`interval '1 minute'`;
  const retention=window==="day"?sql`interval '2 days'`:sql`interval '2 minutes'`;
  const result = await executor.execute<{
    allowed: boolean; used: number; retryAfter: number; resetAt: Date;
  }>(sql`
    WITH stamp AS (SELECT date_trunc(${window}, statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS started),
    consumed AS (
      INSERT INTO valo_rate_buckets (bucket, subject_hash, window_started_at, used_count, expires_at)
      SELECT ${bucket}, ${subjectHash}, started, 1, started + ${retention} FROM stamp
      ON CONFLICT (bucket, subject_hash, window_started_at)
      DO UPDATE SET used_count = valo_rate_buckets.used_count + 1
      WHERE valo_rate_buckets.used_count < ${limit}
      RETURNING used_count
    )
    SELECT EXISTS(SELECT 1 FROM consumed) AS allowed,
      COALESCE((SELECT used_count FROM consumed), ${limit}) AS used,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (started + ${duration} - statement_timestamp()))))::integer AS "retryAfter",
      started + ${duration} AS "resetAt" FROM stamp
  `);
  const row = result.rows[0];
  if (!row) throw new Error("QuotaStorageUnavailable");
  return { ...row, resetAt: new Date(row.resetAt), limit };
}

/** Request-driven expiry only; not a claim of an independently running scheduler. */
export async function purgeExpiredQuotaBuckets(): Promise<void> {
  await db.execute(sql`DELETE FROM valo_rate_buckets WHERE expires_at < CURRENT_TIMESTAMP`);
}
