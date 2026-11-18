import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, valoStaffAssignments, valoStaffRoleChanges } from "@workspace/db";
import { makeStaffRoleService, type StaffTarget } from "./valo-staff-roles";
import { requireFinance, assertFinanceActor } from "../modules/commerce/valo-refunds";
import { requirePrivacyStaff } from "./valo-privacy";
import { staffOperations } from "./valo-customer-access";
import { createStaffRoleRouter } from "../routes/valo-staff-roles";
import { makeVerifiedStaffSession } from "../routes/valo-customer-access";
import { activeStaffAssignment } from "./valo-staff-authority";
import { ValoProblem } from "./valo-problem";

test(
  "staff role governance: disposable PostgreSQL, managed-session boundary and no real role mutations",
  { skip: process.env.VALO_RUN_STAFF_ROLE_TESTS !== "synthetic-development-only", timeout: 60000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const current = await db
      .select()
      .from(valoStaffAssignments)
      .where(and(eq(valoStaffAssignments.role, "system"), activeStaffAssignment()));
    assert.equal(
      current.length,
      0,
      "run this suite first in its fresh disposable database; never mutate another administrator fixture",
    );
    const a = "user_synthetic_system_" + randomUUID(),
      b = "user_synthetic_target_" + randomUUID(),
      c = "user_synthetic_backup_" + randomUUID();
    const ids = [a, b, c],
      actor = (identityId = a) => ({ identityId, recentMfa: true, verifiedAt: Date.now() });
    const role = randomUUID();
    await db.insert(valoStaffAssignments).values({
      id: role,
      identityId: a,
      role: "system",
      grantedBy: "owned synthetic bootstrap",
      reason: "Disposable test database bootstrap only",
    });
    let target: Partial<StaffTarget> = {},
      lookups = 0,
      lookupFailure = false,
      barrier: (() => Promise<void>) | undefined;
    const service = makeStaffRoleService(async (id) => {
      lookups++;
      if (lookupFailure) throw Error("CONTROLLED_IDENTITY_UNAVAILABLE");
      await barrier?.();
      return {
        id,
        label: id + "@example.invalid",
        banned: false,
        locked: false,
        verifiedPrimary: true,
        verifiedAt: Date.now(),
        ...target,
      };
    });
    const input = (identityId = b, rest: Record<string, unknown> = {}) => ({
      requestKey: randomUUID(),
      identityId,
      role: "finance",
      action: "grant",
      grantMode: "permanent",
      expectedVersion: 0,
      reason: "Owned synthetic least-privilege role test",
      acknowledgement: true,
      ...rest,
    });
    async function assignment(identityId: string, role: string) {
      return (
        await db
          .select()
          .from(valoStaffAssignments)
          .where(
            and(
              eq(valoStaffAssignments.identityId, identityId),
              eq(valoStaffAssignments.role, role as "system"),
            ),
          )
      )[0];
    }
    try {
      await t.test(
        "customer, stale MFA, self-grant and provider-ineligible target cannot grant roles",
        async () => {
          await assert.rejects(service.change(actor(b), input()), { status: 403 });
          assert.equal(lookups, 0);
          await assert.rejects(service.change({ ...actor(), recentMfa: false }, input()), { status: 403 });
          await assert.rejects(service.change({ ...actor(), verifiedAt: Date.now() - 30001 }, input()), {
            status: 403,
          });
          await assert.rejects(service.change(actor(), input(a)), { status: 403 });
          for (const patch of [{ banned: true }, { locked: true }, { verifiedPrimary: false }, { id: c }]) {
            target = patch;
            await assert.rejects(service.change(actor(), input()), { status: 403 });
          }
          target = {};
          assert.equal((await db.select().from(valoStaffRoleChanges)).length, 0);
        },
      );
      await t.test(
        "racing grant retries save one assignment and append-only receipt; stale or changed instructions fail",
        async () => {
          const body = input(),
            results = await Promise.all([service.change(actor(), body), service.change(actor(), body)]);
          assert.equal(results[0].id, results[1].id);
          assert.equal((await assignment(b, "finance")).version, 1);
          lookupFailure = true;
          assert.equal(
            (await service.change(actor(), body)).id,
            results[0].id,
            "lost response recovers from saved receipt despite provider outage",
          );
          lookupFailure = false;
          await assert.rejects(
            service.change(actor(), {
              ...body,
              reason: "A different instruction cannot reuse the saved key",
            }),
            { status: 409 },
          );
          await assert.rejects(service.change(actor(), input()), { status: 409 });
          await assert.rejects(
            db
              .update(valoStaffRoleChanges)
              .set({ reason: "tampered" })
              .where(eq(valoStaffRoleChanges.id, results[0].id)),
          );
          await assert.rejects(
            db.delete(valoStaffRoleChanges).where(eq(valoStaffRoleChanges.id, results[0].id)),
          );
        },
      );
      await t.test(
        "audit persistence failure rolls back the assignment in the same transaction",
        async () => {
          await db.execute(
            sql`CREATE FUNCTION valo_test_reject_role_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CONTROLLED_AUDIT_STORAGE_FAILURE'; END; $$`,
          );
          await db.execute(
            sql`CREATE TRIGGER valo_test_reject_role_audit BEFORE INSERT ON valo_staff_role_changes FOR EACH ROW EXECUTE FUNCTION valo_test_reject_role_audit()`,
          );
          try {
            await assert.rejects(service.change(actor(), input(c)));
            assert.equal(await assignment(c, "finance"), undefined);
          } finally {
            await db.execute(sql`DROP TRIGGER valo_test_reject_role_audit ON valo_staff_role_changes`);
            await db.execute(sql`DROP FUNCTION valo_test_reject_role_audit()`);
          }
        },
      );
      await t.test(
        "actor revocation committed during provider lookup prevents assignment and audit",
        async () => {
          let reached!: () => void, release!: () => void;
          const entered = new Promise<void>((r) => (reached = r)),
            held = new Promise<void>((r) => (release = r));
          barrier = async () => {
            reached();
            await held;
          };
          const pending = service.change(actor(), input(c));
          const result = pending.then(
            () => null,
            (e) => e,
          );
          await entered;
          await db
            .update(valoStaffAssignments)
            .set({ active: false })
            .where(eq(valoStaffAssignments.id, role));
          release();
          assert.equal((await result)?.status, 403);
          barrier = undefined;
          await db
            .update(valoStaffAssignments)
            .set({ active: true })
            .where(eq(valoStaffAssignments.id, role));
          assert.equal(await assignment(c, "finance"), undefined);
        },
      );
      await t.test(
        "actor and target freshness are rechecked after the actual target-row lock wait",
        async () => {
          for (const stale of ["actor", "target"] as const) {
            const before = await assignment(b, "finance"),
              auditBefore = (await db.select().from(valoStaffRoleChanges)).length;
            let entered!: (pid: number) => void, release!: () => void;
            const locked = new Promise<number>((r) => (entered = r)),
              hold = new Promise<void>((r) => (release = r));
            const blocker = db.transaction(async (tx) => {
              const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
              await tx.execute(sql`SELECT id FROM valo_staff_assignments WHERE id=${before.id} FOR UPDATE`);
              entered(Number(pid.rows[0].pid));
              await hold;
            });
            const blockerPid = await locked;
            const measured = Date.now() - 29000,
              currentActor = stale === "actor" ? { ...actor(), verifiedAt: measured } : actor();
            target = stale === "target" ? { verifiedAt: measured } : {};
            const pending = service.change(currentActor, input(b, { expectedVersion: before.version }));
            const result = pending.then(
              () => null,
              (e) => e,
            );
            let observed = false;
            const deadline = Date.now() + 3000;
            try {
              while (Date.now() < deadline) {
                const waiting = await db.execute(
                  sql`SELECT pid FROM pg_stat_activity WHERE ${blockerPid}::integer=ANY(pg_blocking_pids(pid))`,
                );
                if (waiting.rowCount) {
                  observed = true;
                  break;
                }
                await new Promise((r) => setTimeout(r, 10));
              }
              assert.equal(observed, true, "the real role mutation waits on this target row");
              await new Promise((r) => setTimeout(r, Math.max(0, 30010 - (Date.now() - measured))));
            } finally {
              release();
              await blocker;
              target = {};
            }
            assert.equal((await result)?.status, 403);
            assert.equal((await assignment(b, "finance")).version, before.version);
            assert.equal(
              (await db.select().from(valoStaffRoleChanges)).length,
              auditBefore,
              "stale eligibility creates no role-change receipt",
            );
          }
        },
      );
      await t.test(
        "all current staff guards reject expired emergency roles without a cleanup worker",
        async () => {
          for (const r of ["content", "support", "finance", "system", "privacy"] as const) {
            const old = await assignment(b, r);
            await service.change(
              actor(),
              input(b, {
                role: r,
                expectedVersion: old?.version ?? 0,
                grantMode: "break_glass",
                durationMinutes: 5,
                incidentReference: "SYNTHETIC-INCIDENT",
              }),
            );
          }
          await assert.rejects(
            service.list(actor(b)),
            { status: 403 },
            "emergency system access cannot administer roles even before expiry",
          );
          await db.execute(
            sql`UPDATE valo_staff_assignments SET granted_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' WHERE identity_id=${b}`,
          );
          await assert.rejects(assertFinanceActor(actor(b)), { status: 403 });
          await assert.rejects(
            db.transaction((tx) => requireFinance(tx, actor(b), "Owned expired role test")),
            { status: 403 },
          );
          await assert.rejects(
            db.transaction((tx) => requirePrivacyStaff(tx, actor(b))),
            { status: 403 },
          );
          for (const area of ["content", "support", "finance", "system"] as const)
            await assert.rejects(staffOperations(actor(b), area), { status: 403 });
          await assert.rejects(
            service.change(
              actor(),
              input(c, { grantMode: "break_glass", durationMinutes: 61, incidentReference: "SYNTHETIC" }),
            ),
          );
        },
      );
      await t.test(
        "expiry while a role read waits on FOR SHARE is rechecked after acquiring the lock",
        async () => {
          const f = await assignment(b, "finance");
          await db.execute(
            sql`UPDATE valo_staff_assignments SET granted_at=clock_timestamp()-interval '5 minutes',expires_at=clock_timestamp()+interval '250 milliseconds' WHERE id=${f.id}`,
          );
          let entered!: () => void, release!: () => void;
          const locked = new Promise<void>((r) => (entered = r)),
            hold = new Promise<void>((r) => (release = r));
          const blocker = db.transaction(async (tx) => {
            await tx.execute(sql`SELECT id FROM valo_staff_assignments WHERE id=${f.id} FOR UPDATE`);
            entered();
            await hold;
          });
          await locked;
          const waiting = db.transaction((tx) => requireFinance(tx, actor(b), "Expiry after role lock wait"));
          const result = waiting.then(
            () => null,
            (e) => e,
          );
          await new Promise((r) => setTimeout(r, 400));
          release();
          await blocker;
          assert.equal((await result)?.status, 403);
        },
      );
      await t.test(
        "privacy and operational reads reject sessions that become stale during an observed assignment lock wait",
        async () => {
          for (const permission of ["privacy", "support"] as const) {
            const saved = await assignment(b, permission);
            await db.execute(
              sql`UPDATE valo_staff_assignments SET granted_at=clock_timestamp()-interval '5 minutes',expires_at=clock_timestamp()+interval '1 minute' WHERE id=${saved.id}`,
            );
            let entered!: (pid: number) => void, release!: () => void;
            const locked = new Promise<number>((r) => (entered = r)),
              hold = new Promise<void>((r) => (release = r));
            const blocker = db.transaction(async (tx) => {
              const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
              await tx.execute(sql`SELECT id FROM valo_staff_assignments WHERE id=${saved.id} FOR UPDATE`);
              entered(Number(pid.rows[0].pid));
              await hold;
            });
            const blockerPid = await locked,
              verifiedAt = Date.now() - 29000,
              currentActor = { ...actor(b), verifiedAt };
            const pending =
              permission === "privacy"
                ? db.transaction((tx) => requirePrivacyStaff(tx, currentActor))
                : staffOperations(currentActor, permission);
            const result = pending.then(
              () => null,
              (e) => e,
            );
            let observed = false;
            try {
              const deadline = Date.now() + 3000;
              while (Date.now() < deadline) {
                const waiting = await db.execute(
                  sql`SELECT pid FROM pg_stat_activity WHERE ${blockerPid}::integer=ANY(pg_blocking_pids(pid))`,
                );
                if (waiting.rowCount) {
                  observed = true;
                  break;
                }
                await new Promise((r) => setTimeout(r, 10));
              }
              assert.equal(observed, true, "the protected read must actually wait for the held role row");
              await new Promise((r) => setTimeout(r, Math.max(0, 30010 - (Date.now() - verifiedAt))));
            } finally {
              release();
              await blocker;
            }
            assert.equal((await result)?.status, 403, "freshness must be checked after the lock wait");
          }
        },
      );
      await t.test(
        "real HTTP uses managed session, exact account binding, fresh MFA and same-origin JSON",
        async () => {
          let session = { status: "active", userId: a },
            userId: string | null = a,
            sessionId: string | null = "controlled-session",
            mfa = true;
          const authenticate = makeVerifiedStaffSession({
            auth: () => ({
              userId,
              sessionId,
              sessionClaims: { fva: mfa ? [0, 0] : [0, -1] },
              has: () => mfa,
            }),
            session: async () => session,
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
          app.use(express.json());
          app.use(createStaffRoleRouter(authenticate, service));
          app.use((e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
            res
              .status(e instanceof ValoProblem ? e.status : 422)
              .json({ error: "controlled-boundary-error" }),
          );
          const server = app.listen(0, "127.0.0.1");
          await new Promise<void>((r) => server.once("listening", r));
          const base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
          const origin = process.env.VALO_TRUSTED_ORIGIN;
          process.env.VALO_TRUSTED_ORIGIN = base;
          try {
            const read = await fetch(base + "/admin/staff-roles");
            assert.equal(read.status, 200);
            assert.match(read.headers.get("Cache-Control")!, /no-store/);
            sessionId = null;
            assert.equal((await fetch(base + "/admin/staff-roles")).status, 401);
            sessionId = "controlled-session";
            session = { status: "revoked", userId: a };
            assert.equal((await fetch(base + "/admin/staff-roles")).status, 403);
            session = { status: "active", userId: c };
            assert.equal((await fetch(base + "/admin/staff-roles")).status, 403);
            session = { status: "active", userId: a };
            mfa = false;
            assert.equal((await fetch(base + "/admin/staff-roles")).status, 403);
            mfa = true;
            const before = lookups;
            assert.equal(
              (
                await fetch(base + "/admin/staff-role-target", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Origin: "https://hostile.invalid" },
                  body: JSON.stringify({ identityId: c }),
                })
              ).status,
              403,
            );
            assert.equal(lookups, before);
            const valid = await fetch(base + "/admin/staff-role-target", {
              method: "POST",
              headers: { "Content-Type": "application/json", Origin: base },
              body: JSON.stringify({ identityId: c }),
            });
            assert.equal(valid.status, 200);
          } finally {
            await new Promise<void>((r) => server.close(() => r()));
            if (origin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
            else process.env.VALO_TRUSTED_ORIGIN = origin;
          }
        },
      );
      await t.test(
        "exact identity lookup reaches old permissions and revokes without the target provider",
        async () => {
          const fillers = Array.from({ length: 251 }, () => ({
            id: randomUUID(),
            identityId: "user_synthetic_old_" + randomUUID(),
            role: "support" as const,
            active: false,
            grantedBy: "owned synthetic fixture",
            reason: "Inactive directory pagination fixture only",
            grantedAt: new Date(),
          }));
          await db.insert(valoStaffAssignments).values(fillers);
          try {
            const old = await assignment(b, "finance"),
              overview = await service.list(actor());
            assert.equal(
              overview.assignments.some((r) => r.id === old.id),
              false,
            );
            lookupFailure = true;
            const exact = await service.list(actor(), { identityId: b });
            assert.equal(exact.assignments.find((r) => r.id === old.id)?.version, old.version);
            const revoked = await service.change(
              actor(),
              input(b, { action: "revoke", grantMode: undefined, expectedVersion: old.version }),
            );
            assert.equal(revoked.action, "revoke");
            assert.equal((await assignment(b, "finance")).active, false);
          } finally {
            lookupFailure = false;
            await db.delete(valoStaffAssignments).where(
              inArray(
                valoStaffAssignments.id,
                fillers.map((r) => r.id),
              ),
            );
          }
        },
      );
      await t.test(
        "last permanent admin survives self-revocation and racing mutual revocations",
        async () => {
          await assert.rejects(
            service.change(
              actor(),
              input(a, { action: "revoke", role: "system", expectedVersion: 1, grantMode: undefined }),
            ),
            { status: 409 },
          );
          await service.change(actor(), input(c, { role: "system" }));
          const revokeA = input(a, {
              role: "system",
              action: "revoke",
              expectedVersion: 1,
              grantMode: undefined,
            }),
            revokeC = input(c, {
              role: "system",
              action: "revoke",
              expectedVersion: 1,
              grantMode: undefined,
            });
          const results = await Promise.allSettled([
            service.change(actor(c), revokeA),
            service.change(actor(), revokeC),
          ]);
          assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
          const permanent = await db
            .select()
            .from(valoStaffAssignments)
            .where(
              and(
                eq(valoStaffAssignments.role, "system"),
                eq(valoStaffAssignments.grantMode, "permanent"),
                activeStaffAssignment(),
              ),
            );
          assert.equal(permanent.length, 1);
        },
      );
    } finally {
      // Retain immutable synthetic audit history, deactivate only this suite's identities.
      for (const id of ids)
        await db
          .update(valoStaffAssignments)
          .set({ active: false })
          .where(eq(valoStaffAssignments.identityId, id));
      await pool.end();
    }
  },
);
