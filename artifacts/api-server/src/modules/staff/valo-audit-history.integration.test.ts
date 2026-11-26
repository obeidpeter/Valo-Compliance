import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, valoStaffAccessAudit, valoStaffAssignments } from "@workspace/db";
import { GetAuditHistoryResponse } from "@workspace/api-zod";
import { AUDIT_HISTORY_PAGE_SIZE, auditHistory, type AuditHistoryKind } from "./valo-audit-history";
import { countHistories } from "../operations";
import { createStaffRoleRouter } from "../../routes/valo-staff-roles";
import { makeVerifiedStaffSession } from "../../lib/valo-managed-session";
import { onError } from "../../platform/http-errors";

const KINDS: AuditHistoryKind[] = ["access", "safety", "prices", "refunds", "counts"];
const TABLES: Record<AuditHistoryKind, string> = {
  access: "valo_staff_access_audit",
  safety: "valo_safety_control_audit",
  prices: "valo_price_changes",
  refunds: "valo_refund_transitions",
  counts: "valo_history_checks",
};

test(
  "audit history: only a permanent system operator reads it, each read is recorded first, and reading changes no other history",
  { skip: process.env.VALO_RUN_STAFF_ROLE_TESTS !== "synthetic-development-only", timeout: 60000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const operator = "user_synthetic_audit_reader_" + randomUUID(),
      finance = "user_synthetic_audit_finance_" + randomUUID(),
      emergency = "user_synthetic_audit_emergency_" + randomUUID(),
      stranger = "user_synthetic_audit_stranger_" + randomUUID();
    const assigned = [operator, finance, emergency],
      actor = (identityId = operator) => ({ identityId, recentMfa: true, verifiedAt: Date.now() });
    const grantedAt = new Date(),
      fixture = { grantedBy: "owned synthetic fixture", reason: "Disposable audit history viewer test only" };
    await db.insert(valoStaffAssignments).values([
      { id: randomUUID(), identityId: operator, role: "system", ...fixture },
      { id: randomUUID(), identityId: finance, role: "finance", ...fixture },
      {
        id: randomUUID(),
        identityId: emergency,
        role: "system",
        grantMode: "break_glass",
        grantedAt,
        expiresAt: new Date(grantedAt.getTime() + 30 * 60_000),
        ...fixture,
      },
    ]);
    const reads = (identityId: string) =>
      db.select().from(valoStaffAccessAudit).where(eq(valoStaffAccessAudit.actorId, identityId));
    const rows = async (kind: AuditHistoryKind) =>
      Number(
        (await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ${sql.identifier(TABLES[kind])}`))
          .rows[0]?.n,
      );
    try {
      await t.test(
        "staff without a current permanent system assignment and a fresh session read nothing and leave no row",
        async () => {
          for (const refused of [
            actor(finance),
            actor(emergency),
            actor(stranger),
            { ...actor(), recentMfa: false },
            { ...actor(), verifiedAt: Date.now() - 30_001 },
          ])
            await assert.rejects(auditHistory(refused, { kind: "access" }), { status: 403 });
          for (const query of [
            {},
            { kind: "everything" },
            { kind: "access", page: "0" },
            { kind: "access", page: "1001" },
            { kind: "access", workspaceId: randomUUID() },
          ])
            await assert.rejects(auditHistory(actor(), query), { name: "ZodError" });
          for (const id of [...assigned, stranger]) assert.deepEqual(await reads(id), []);
        },
      );
      await t.test(
        "a read is recorded before the page is read, naming the history and the page",
        async () => {
          const first = GetAuditHistoryResponse.parse(await auditHistory(actor(), { kind: "access" }));
          assert.deepEqual([first.kind, first.page, first.pageSize], ["access", 1, AUDIT_HISTORY_PAGE_SIZE]);
          const top = first.entries[0]!;
          assert.deepEqual(
            [top.actor, top.action, top.object, top.reason],
            [operator, "Read in system", "audit_history:access", "Read page 1 of the access history"],
          );
          await auditHistory(actor(), { kind: "counts", page: "2" });
          const counted = (await reads(operator)).find((row) => row.object === "audit_history:counts");
          assert.deepEqual([counted?.area, counted?.reason], ["system", "Read page 2 of the counts history"]);
        },
      );
      await t.test("pages run newest first, fifty to a page", async () => {
        let first = await auditHistory(actor(), { kind: "access" });
        while (first.total <= AUDIT_HISTORY_PAGE_SIZE)
          first = await auditHistory(actor(), { kind: "access" });
        assert.equal(first.entries.length, AUDIT_HISTORY_PAGE_SIZE);
        const second = await auditHistory(actor(), { kind: "access", page: 2 });
        assert.ok(second.entries.length >= 1);
        // The second read adds its own row at the top, so the second page starts where the first ended.
        assert.equal(second.entries[0]!.id, first.entries.at(-1)!.id);
        const times = [...first.entries, ...second.entries].map((entry) => entry.at.getTime());
        assert.deepEqual(
          times,
          [...times].sort((a, b) => b - a),
        );
        const beyond = await auditHistory(actor(), { kind: "access", page: 1000 });
        assert.deepEqual(beyond.entries, []);
        assert.ok(beyond.total > AUDIT_HISTORY_PAGE_SIZE + 1);
      });
      await t.test(
        "every history's page fits the contract on the real tables, a real count reads plainly, and no refund's reason is shown",
        async () => {
          // A real count, unless one was kept within the hour; either way the latest count is real.
          const count = await countHistories();
          const before = Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, await rows(k)])));
          for (const kind of KINDS) {
            const page = GetAuditHistoryResponse.parse(await auditHistory(actor(), { kind }));
            assert.equal(page.kind, kind);
            // The access history is read first, so its total already holds that read.
            assert.equal(page.total, before[kind] + (kind === "access" ? 1 : 0));
            if (kind === "refunds") assert.ok(page.entries.every((entry) => entry.reason === null));
            if (kind === "counts") {
              const latest = page.entries[0]!;
              assert.equal(latest.actor, "worker");
              assert.match(
                latest.action,
                /^(Every history matched its digest|1 history no longer matched its digest|\d+ histories no longer matched their digests)$/,
              );
              if (count.counted)
                assert.equal(
                  latest.reason,
                  count.mismatched.length === 0 ? null : count.mismatched.join(", "),
                );
            }
          }
          // Reading added one row to the access history for each history read, and nothing anywhere else.
          for (const kind of KINDS)
            assert.equal(await rows(kind), before[kind] + (kind === "access" ? KINDS.length : 0));
          const objects = new Set((await reads(operator)).map((row) => row.object));
          for (const kind of KINDS) assert.ok(objects.has(`audit_history:${kind}`), kind);
        },
      );
      await t.test(
        "over HTTP it answers only a fresh staff session, is never cached, and refuses a query it does not know",
        async () => {
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
          app.use(createStaffRoleRouter(authenticate));
          app.use(onError);
          const server = app.listen(0, "127.0.0.1");
          await new Promise<void>((resolve) => server.once("listening", resolve));
          const base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
          try {
            const read = await fetch(base + "/admin/audit-history?kind=access&page=1");
            assert.equal(read.status, 200);
            assert.match(read.headers.get("Cache-Control")!, /no-store/);
            const body = GetAuditHistoryResponse.parse(await read.json());
            assert.equal(body.entries[0]?.object, "audit_history:access");
            const unknown = await fetch(base + "/admin/audit-history?kind=everything");
            assert.equal(unknown.status, 422);
            assert.match(unknown.headers.get("Cache-Control")!, /no-store/);
            mfa = false;
            assert.equal((await fetch(base + "/admin/audit-history?kind=access")).status, 403);
            mfa = true;
            userId = null;
            assert.equal((await fetch(base + "/admin/audit-history?kind=access")).status, 401);
          } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
          }
        },
      );
    } finally {
      // The histories keep this suite's reads; only its assignments are ended.
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(inArray(valoStaffAssignments.identityId, assigned));
      await pool.end();
    }
  },
);
