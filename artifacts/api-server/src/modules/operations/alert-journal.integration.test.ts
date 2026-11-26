import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, valoOperationalAlerts, valoStaffAssignments } from "@workspace/db";
import { GetOperationalAlertsResponse } from "@workspace/api-zod";
import {
  ALERT_CHANGES_SHOWN,
  collectOperationalSample,
  copyAlertChanges,
  operationalAlerts,
  publishAlertChanges,
  readinessQueries,
  recordOperationalAlerts,
  recordWorkerHeartbeat,
} from ".";
import { WorkerHealth } from "../../platform/valo-worker-health";
import { createOperationalAlertsRouter } from "../../routes/valo-operational-alerts";
import { makeVerifiedStaffSession } from "../../lib/valo-managed-session";
import { onError } from "../../platform/http-errors";

/**
 * SEC-008, NFR-010 (docs/architecture/alerts.md, part 1): the worker's alert changes reach the database's
 * journal through the real copy, once each, and are kept as they were written; a system operator reads
 * them, emergency access included, and no one else. The readings are a stand-in for the database's, so
 * this test chooses what each alert says; no message leaves Valo.
 */
test(
  "operational alerts: the journal takes each change once and keeps it, and only a current system operator reads it",
  { skip: process.env.VALO_RUN_STAFF_ROLE_TESTS !== "synthetic-development-only", timeout: 60000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const operator = "user_synthetic_alert_reader_" + randomUUID(),
      emergency = "user_synthetic_alert_emergency_" + randomUUID(),
      lapsed = "user_synthetic_alert_lapsed_" + randomUUID(),
      finance = "user_synthetic_alert_finance_" + randomUUID(),
      stranger = "user_synthetic_alert_stranger_" + randomUUID();
    const assigned = [operator, emergency, lapsed, finance],
      actor = (identityId = operator) => ({ identityId, recentMfa: true, verifiedAt: Date.now() });
    const now = Date.now(),
      fixture = { grantedBy: "owned synthetic fixture", reason: "Disposable operational alerts test only" };
    await db.insert(valoStaffAssignments).values([
      { id: randomUUID(), identityId: operator, role: "system", ...fixture },
      {
        id: randomUUID(),
        identityId: emergency,
        role: "system",
        grantMode: "break_glass",
        grantedAt: new Date(now),
        expiresAt: new Date(now + 30 * 60_000),
        ...fixture,
      },
      {
        id: randomUUID(),
        identityId: lapsed,
        role: "system",
        grantMode: "break_glass",
        grantedAt: new Date(now - 60 * 60_000),
        expiresAt: new Date(now - 30 * 60_000),
        ...fixture,
      },
      { id: randomUUID(), identityId: finance, role: "finance", ...fixture },
    ]);
    const dir = await mkdtemp(join(tmpdir(), "valo-alert-journal-"));
    const worker = new WorkerHealth();
    worker.finish(worker.begin()!, true);
    await recordWorkerHeartbeat(worker.snapshot(), dir);
    /** A reading in which the database answers and every other query reads `value(query)`. */
    const reading = (value: (query: string) => number) =>
      collectOperationalSample(
        async (query) => ({ rows: [{ value: query === readinessQueries.database ? 1 : value(query) }] }),
        dir,
      );
    const fileJournal = async () =>
      JSON.parse(await readFile(join(dir, "alerts.json"), "utf8")) as {
        published: number;
        events: { id: string; code: string; state: string }[];
      };
    const kept = (ids: string[]) =>
      db.select().from(valoOperationalAlerts).where(inArray(valoOperationalAlerts.id, ids));
    let ids: string[] = [];
    try {
      await t.test(
        "the worker's changes reach the journal through the real copy, once each, by their own ids",
        async () => {
          // A role changed and a signature failed; then the signature failures stopped.
          await recordOperationalAlerts(
            await reading((q) =>
              q === readinessQueries.roleChanges || q === readinessQueries.signatureFailures ? 1 : 0,
            ),
            dir,
          );
          await recordOperationalAlerts(
            await reading((q) => (q === readinessQueries.roleChanges ? 1 : 0)),
            dir,
          );
          assert.deepEqual(await copyAlertChanges(publishAlertChanges, dir), {
            copied: 3,
            behind: 0,
            lost: 0,
          });
          ids = (await fileJournal()).events.map((change) => change.id);
          const rows = await kept(ids);
          assert.equal(rows.length, 3);
          const byId = new Map(rows.map((row) => [row.id, row]));
          assert.deepEqual(
            (await fileJournal()).events.map((change) => {
              const row = byId.get(change.id)!;
              return [row.code, row.state, row.reading, row.threshold, row.runbook, row.accountable];
            }),
            [
              [
                "SIGNATURE_FAILURES_DETECTED",
                "active",
                1,
                0,
                "Security/privacy incident",
                "Incident lead + privacy owner",
              ],
              [
                "ROLE_CHANGES_DETECTED",
                "active",
                1,
                0,
                "Security/privacy incident",
                "Incident lead + privacy owner",
              ],
              [
                "SIGNATURE_FAILURES_DETECTED",
                "resolved",
                0,
                0,
                "Security/privacy incident",
                "Incident lead + privacy owner",
              ],
            ],
          );
          // The worker stopped after the database took them but before it marked them copied: the next copy
          // sends them all again, and the journal keeps each as it first took it.
          const file = await fileJournal();
          await writeFile(join(dir, "alerts.json"), JSON.stringify({ ...file, published: 0 }));
          assert.deepEqual(await copyAlertChanges(publishAlertChanges, dir), {
            copied: 3,
            behind: 0,
            lost: 0,
          });
          const byIdOrder = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
          assert.deepEqual(
            (await kept(ids)).sort(byIdOrder).map((row) => [row.id, row.state, row.recordedAt.getTime()]),
            [...rows].sort(byIdOrder).map((row) => [row.id, row.state, row.recordedAt.getTime()]),
          );
        },
      );
      await t.test(
        "the journal refuses any change to a change it holds, and keeps its history digest",
        async () => {
          // The database's refusal, under the driver's wrapper.
          const refusedBy = (words: RegExp) => (error: unknown) =>
            words.test(String((error as { cause?: Error }).cause?.message ?? error));
          await assert.rejects(
            db
              .update(valoOperationalAlerts)
              .set({ state: "resolved" })
              .where(eq(valoOperationalAlerts.id, ids[0]!)),
            refusedBy(/never changed or removed/),
          );
          await assert.rejects(
            db.delete(valoOperationalAlerts).where(eq(valoOperationalAlerts.id, ids[0]!)),
            refusedBy(/never changed or removed/),
          );
          await assert.rejects(db.execute(sql`TRUNCATE valo_operational_alerts`));
          assert.equal((await kept(ids)).length, 3);
          const mismatched = await db.execute<{ name: string }>(
            sql`SELECT name FROM valo_history_digest_mismatches() AS name`,
          );
          assert.ok(
            !mismatched.rows.some((row) => row.name === "valo_operational_alerts"),
            "the journal's digest matches",
          );
        },
      );
      await t.test(
        "a system operator, emergency access included, reads the alerts active now and the latest changes, newest first, in plain words",
        async () => {
          for (const reader of [operator, emergency]) {
            const alerts = GetOperationalAlertsResponse.parse(await operationalAlerts(actor(reader)));
            const role = alerts.active.find((alert) => alert.code === "ROLE_CHANGES_DETECTED");
            assert.deepEqual(role, {
              id: ids[1],
              code: "ROLE_CHANGES_DETECTED",
              title: "A staff role was changed in the last hour",
              state: "active",
              at: role?.at,
              reading: 1,
              threshold: 0,
              runbook: "Security/privacy incident",
              accountable: "Incident lead + privacy owner",
            });
            // The signature failures were cleared, so they are not active, and the latest change says so.
            // The two raised by one reading share its time, so their order between them is not set.
            assert.ok(!alerts.active.some((alert) => alert.code === "SIGNATURE_FAILURES_DETECTED"));
            const mine = alerts.changes.filter((change) => ids.includes(change.id));
            assert.equal(mine.length, 3);
            assert.deepEqual(
              [mine[0]?.id, mine[0]?.state, mine[0]?.title],
              [ids[2], "resolved", "A message from the payment provider failed its signature check"],
            );
            assert.deepEqual(new Set(mine.slice(1).map((change) => change.id)), new Set([ids[0], ids[1]]));
            assert.ok(alerts.changes.length <= ALERT_CHANGES_SHOWN);
            const times = alerts.changes.map((change) => change.at.getTime());
            assert.deepEqual(
              times,
              [...times].sort((a, b) => b - a),
            );
            assert.ok(alerts.active.every((alert) => alert.state === "active"));
          }
        },
      );
      await t.test("staff without a current system assignment or a fresh session read nothing", async () => {
        for (const refused of [
          actor(lapsed),
          actor(finance),
          actor(stranger),
          { ...actor(), recentMfa: false },
          { ...actor(), verifiedAt: Date.now() - 30_001 },
        ])
          await assert.rejects(operationalAlerts(refused), { status: 403 });
      });
      await t.test("over HTTP it answers only a fresh staff session and is never cached", async () => {
        let userId: string | null = operator,
          mfa = true;
        const authenticate = makeVerifiedStaffSession({
          auth: () => ({
            userId,
            sessionId: userId === null ? null : "controlled-session",
            sessionClaims: { fva: mfa ? [0, 0] : [0, -1] },
            has: () => mfa,
          }),
          session: async () => ({ status: "active", userId: operator }),
          user: async (id) => ({
            id,
            banned: false,
            locked: false,
            twoFactorEnabled: true,
            primaryEmailAddressId: "email",
            emailAddresses: [{ id: "email", verification: { status: "verified" } }],
          }),
        });
        const app = express();
        app.use(createOperationalAlertsRouter(authenticate));
        app.use(onError);
        const server = app.listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
        try {
          const read = await fetch(base + "/admin/operations/alerts");
          assert.equal(read.status, 200);
          assert.match(read.headers.get("Cache-Control")!, /no-store/);
          const body = GetOperationalAlertsResponse.parse(await read.json());
          assert.ok(body.active.some((alert) => alert.id === ids[1]));
          mfa = false;
          const unverified = await fetch(base + "/admin/operations/alerts");
          assert.equal(unverified.status, 403);
          assert.match(unverified.headers.get("Cache-Control")!, /no-store/);
          mfa = true;
          userId = null;
          assert.equal((await fetch(base + "/admin/operations/alerts")).status, 401);
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      });
    } finally {
      // The journal keeps this suite's alerts, as it keeps every alert; only its assignments are ended.
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(inArray(valoStaffAssignments.identityId, assigned));
      await rm(dir, { recursive: true, force: true });
      await pool.end();
    }
  },
);
