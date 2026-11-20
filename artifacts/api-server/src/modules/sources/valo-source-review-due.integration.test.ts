import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { contentReviewDue, ruleReviewDue } from "./valo-source-corrections";

// EDP-011 re-reviews high-impact content monthly and other content quarterly. The source monitor
// queues a published content version or rule release for that review when these conditions hold.
// Only the publisher can make a version published, and tests never forge one, so the conditions
// run here in PostgreSQL against synthetic values written into the query itself. No row is
// written to any table.
const day = 86400000,
  now = new Date("2026-11-20T12:00:00.000Z");
const ago = (days: number) => new Date(+now - days * day).toISOString(),
  ahead = (days: number) => new Date(+now + days * day).toISOString();

type Case = { id: string; reviewBy: string; checked: string; risk?: string; due: boolean };
const cases: Case[] = [
  { id: "high-impact-checked-29-days-ago", reviewBy: ahead(60), checked: ago(29), risk: "tax", due: false },
  { id: "high-impact-checked-30-days-ago", reviewBy: ahead(60), checked: ago(30), risk: "tax", due: true },
  { id: "general-checked-31-days-ago", reviewBy: ahead(60), checked: ago(31), risk: "general", due: false },
  { id: "general-checked-89-days-ago", reviewBy: ahead(60), checked: ago(89), risk: "general", due: false },
  { id: "general-checked-90-days-ago", reviewBy: ahead(60), checked: ago(90), risk: "general", due: true },
  // A version that records no risk is reviewed as often as high-impact content.
  { id: "no-risk-checked-30-days-ago", reviewBy: ahead(60), checked: ago(30), due: true },
  { id: "review-date-reached", reviewBy: ago(0), checked: ago(1), risk: "general", due: true },
  { id: "review-date-tomorrow", reviewBy: ahead(1), checked: ago(1), risk: "employment", due: false },
];
const expected = cases
  .filter((c) => c.due)
  .map((c) => c.id)
  .sort();

test(
  "a version is due for review when its review date passes, or 30 days after its source check (90 for general content)",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 30000 },
  async () => {
    assert.ok(
      process.env.DATABASE_URL &&
        ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname),
      "This test may use only a loopback, disposable development database",
    );
    const { db, pool } = await import("@workspace/db");
    const ids = (rows: Record<string, unknown>[]) => rows.map((r) => String(r.id)).sort();
    try {
      const contentRows = sql.join(
        cases.map(
          (c) =>
            sql`(${c.id}, ${c.reviewBy}::timestamptz, ${JSON.stringify({ candidate: { sourceCheckDate: c.checked, risk: c.risk } })}::jsonb)`,
        ),
        sql`, `,
      );
      const content = await db.execute(
        sql`select id from (values ${contentRows}) as c(id, review_by, bundle) where ${contentReviewDue(now)}`,
      );
      assert.deepEqual(ids(content.rows), expected);

      const ruleRows = sql.join(
        cases.map(
          (c) =>
            sql`(${c.id}, ${JSON.stringify({ reviewBy: c.reviewBy, sourceCheckedAt: c.checked })}::jsonb, ${JSON.stringify({ candidate: { risk: c.risk } })}::jsonb)`,
        ),
        sql`, `,
      );
      const rules = await db.execute(
        sql`select id from (values ${ruleRows}) as r(id, rule, publication_bundle) where ${ruleReviewDue(now)}`,
      );
      assert.deepEqual(ids(rules.rows), expected);
    } finally {
      await pool.end();
    }
  },
);
