import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import { inArray, sql } from "drizzle-orm";
import { db, pool, valoRateBuckets } from "@workspace/db";
import { consumeQuota, purgeExpiredQuotaBuckets } from "./valo-quota";

test(
  "synthetic PostgreSQL quotas are atomic, durable and scoped",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, "production");
    const keys = [0, 1, 2].map(() =>
      createHash("sha256").update(`synthetic-quota-${randomUUID()}`).digest("hex"),
    );
    try {
      await t.test("concurrent callers cannot exceed one shared database cap", async () => {
        // The quota counts in windows of one database-clock minute. Start well inside one, so the
        // twenty calls and the refused call after them fall in the same window.
        const [clock] = (
          await db.execute(sql`select extract(second from statement_timestamp())::float8 as second`)
        ).rows;
        const second = Number(clock?.second);
        if (second > 50) await new Promise((resolve) => setTimeout(resolve, (61 - second) * 1000));
        const results = await Promise.all(
          Array.from({ length: 20 }, () => consumeQuota("customer-ai", keys[0]!, 5)),
        );
        // A boundary crossover is not treated as successful concurrency evidence.
        assert.equal(
          new Set(results.map((r) => r.resetAt.toISOString())).size,
          1,
          "Repeat this synthetic test if it crossed a minute boundary",
        );
        assert.equal(results.filter((r) => r.allowed).length, 5);
        assert.ok(results.every((r) => r.retryAfter >= 1 && r.retryAfter <= 60));
        const persisted = await db
          .select()
          .from(valoRateBuckets)
          .where(inArray(valoRateBuckets.subjectHash, [keys[0]!]));
        assert.equal(persisted[0]!.usedCount, 5);
        const refused = await consumeQuota("customer-ai", keys[0]!, 5);
        assert.equal(
          refused.resetAt.toISOString(),
          results[0]!.resetAt.toISOString(),
          "the call after the cap falls in the same window",
        );
        assert.equal(refused.allowed, false);
      });
      await t.test("another subject and operation have independent allowances", async () => {
        assert.equal((await consumeQuota("customer-ai", keys[1]!, 5)).allowed, true);
        assert.equal((await consumeQuota("export-create", keys[0]!, 10)).allowed, true);
      });
      await t.test("durable state is visible through a separate database connection", async () => {
        const client = await pool.connect();
        try {
          const result = await client.query(
            "SELECT used_count FROM valo_rate_buckets WHERE subject_hash=$1 AND bucket=$2",
            [keys[0], "customer-ai"],
          );
          assert.equal(result.rows[0].used_count, 5);
        } finally {
          client.release();
        }
      });
      await t.test("expiry cleanup removes only expired windows, leaving current usage intact", async () => {
        await db.execute(sql`INSERT INTO valo_rate_buckets (bucket,subject_hash,window_started_at,used_count,expires_at)
        VALUES ('anonymous-read', ${keys[2]}, CURRENT_TIMESTAMP - interval '10 minutes', 1, CURRENT_TIMESTAMP - interval '8 minutes')`);
        await purgeExpiredQuotaBuckets();
        const rows = await db
          .select()
          .from(valoRateBuckets)
          .where(inArray(valoRateBuckets.subjectHash, keys));
        assert.ok(rows.every((r) => r.subjectHash !== keys[2]));
        assert.ok(rows.some((r) => r.subjectHash === keys[0] && r.usedCount === 5));
      });
      await t.test("invalid bucket, identity and ceilings never mutate storage", async () => {
        await assert.rejects(consumeQuota("customer-ai", "unhashed-personal-data", 5), /Invalid/);
        await assert.rejects(consumeQuota("customer-ai", keys[1]!, 0), /Invalid/);
        await assert.rejects(consumeQuota("customer-ai", keys[1]!, 1.5), /Invalid/);
      });
    } finally {
      await db.delete(valoRateBuckets).where(inArray(valoRateBuckets.subjectHash, keys));
      await pool.end();
    }
  },
);
