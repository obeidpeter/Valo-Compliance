import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import { sql } from "drizzle-orm";
import { currentWorkspaceScope, db, runInWorkspaceScope } from "@workspace/db";
import { securitySignals } from "../middlewares/valo-security-signals";
import { readinessQueries } from "../modules/operations/valo-operations";
import { quotaSubjectHash } from "./valo-quota-policy";
import {
  purgeExpiredSecuritySignals,
  recordSecuritySignal,
  securitySubjectHash,
} from "./valo-security-signals";

const secret = "synthetic-security-signal-key-for-tests-only";
const hashOf = (subject: string) => securitySubjectHash(secret, "ip", subject);
const reading = async (query: string) => Number((await db.execute(sql.raw(query))).rows[0]!.value);

// SEC-008: "Alert on repeated denied access, bulk exports, role changes, signature failures and
// unusual payment/AI activity."
test(
  "refusals and signature failures are counted by hashed address, outside any workspace scope, for the security alerts",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 30000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const subject = hashOf(`synthetic-${randomUUID()}`);
    const app = express();
    app.use(securitySignals({ subject: () => subject }));
    app.get("/ok", (_req, res) => void res.json({ ok: true }));
    app.get("/missing", (_req, res) => void res.status(404).json({}));
    app.get("/limited", (_req, res) => void res.status(429).json({}));
    app.get("/refused", (_req, res) => void res.status(401).json({}));
    app.get("/forbidden", (_req, res) => void res.status(403).json({}));
    // A customer request refused inside its workspace scope is still counted on the application's
    // own connection: the scoped role has no access to the signals.
    app.get("/forbidden-in-scope", (_req, res) =>
      runInWorkspaceScope(randomUUID(), () => {
        assert.ok(currentWorkspaceScope());
        res.status(403).json({});
      }),
    );
    app.post("/webhook", (_req, res) => {
      res.locals.valoSecuritySignal = "signature_failure";
      res.status(401).json({});
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const counts = async () =>
      (
        await db.execute<{ kind: string; n: number }>(
          sql`select kind, sum(count)::int as n from valo_security_signals where subject_hash=${subject} group by kind order by kind`,
        )
      ).rows;
    try {
      for (const path of ["/ok", "/missing", "/limited", "/refused", "/forbidden", "/forbidden-in-scope"])
        await (await fetch(base + path)).body?.cancel();
      await (await fetch(base + "/webhook", { method: "POST" })).body?.cancel();
      // Counting happens after each response is sent, so wait for it.
      const expected = [
        { kind: "denied_access", n: 3 },
        { kind: "signature_failure", n: 1 },
      ];
      for (let i = 0; i < 50 && JSON.stringify(await counts()) !== JSON.stringify(expected); i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.deepEqual(await counts(), expected);
    } finally {
      server.close();
    }

    // The probe's readings see them.
    assert.ok((await reading(readinessQueries.deniedAccess)) >= 3);
    assert.ok((await reading(readinessQueries.signatureFailures)) >= 1);
    // A caller at a quota limit is read as bulk exports, unusual payment activity or unusual AI use.
    for (const [bucket, limit, query] of [
      ["export-create", 10, readinessQueries.bulkExports],
      ["checkout-create", 10, readinessQueries.paymentActivity],
      ["customer-ai", 5, readinessQueries.aiActivity],
    ] as const) {
      const before = await reading(query);
      await db.execute(sql`insert into valo_rate_buckets(bucket, subject_hash, window_started_at, used_count, expires_at)
        values(${bucket}, ${hashOf(`synthetic-${randomUUID()}`)}, date_trunc('minute', now()), ${limit}, now() + interval '2 minutes')`);
      assert.equal(await reading(query), before + 1, bucket);
    }
    assert.ok((await reading(readinessQueries.roleChanges)) >= 0);

    // Counting refuses to run inside a workspace scope, and its subject is a keyed hash that differs
    // from the quota hash of the same address and contains no part of it.
    await assert.rejects(
      runInWorkspaceScope(randomUUID(), () => recordSecuritySignal("denied_access", subject)),
      /SecuritySignalInsideWorkspaceScope/,
    );
    assert.match(subject, /^[a-f0-9]{64}$/);
    assert.notEqual(
      securitySubjectHash(secret, "ip", "203.0.113.7"),
      quotaSubjectHash(secret, "ip", "203.0.113.7"),
    );
    assert.doesNotMatch(securitySubjectHash(secret, "ip", "203.0.113.7"), /203|113/);

    // A failure to count never changes the response.
    const failing = express();
    failing.use(
      securitySignals({
        subject: () => subject,
        record: async () => {
          throw new Error("SYNTHETIC_RECORD_FAILURE");
        },
      }),
    );
    failing.get("/forbidden", (_req, res) => void res.status(403).json({ refused: true }));
    const second = failing.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => second.once("listening", resolve));
    const port = (second.address() as { port: number }).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/forbidden`);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { refused: true });
    } finally {
      second.close();
    }

    // Rows past their expiry are removed.
    const expired = hashOf(`synthetic-${randomUUID()}`);
    await db.execute(sql`insert into valo_security_signals(kind, subject_hash, window_started_at, count, expires_at)
      values('denied_access', ${expired}, now() - interval '2 days', 1, now() - interval '1 day')`);
    await purgeExpiredSecuritySignals();
    assert.equal(
      (await db.execute(sql`select 1 from valo_security_signals where subject_hash=${expired}`)).rows.length,
      0,
    );
  },
);
