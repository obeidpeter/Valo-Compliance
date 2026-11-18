import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, pool, valoStaffAssignments } from "@workspace/db";
import { createFinancePaymentConcernsRouter, customerPaymentConcernsRouter } from "./valo-payment-concerns";
import { makeVerifiedStaffSession, makeDisputeOperationsRouter } from "./valo-customer-access";
import { disputeFixture } from "../modules/commerce/valo-dispute-workflow-fixture";
import {
  linkFinanceDispute,
  prepareDisputeAction,
  financeDispute,
} from "../modules/commerce/valo-dispute-actions";
import { ValoProblem } from "../lib/valo-problem";

test(
  "actual dispute HTTP routers enforce managed finance authority, tenant binding and same-origin writes",
  { timeout: 30000 },
  async (t) => {
    process.env.VALO_RUN_DISPUTE_TESTS = "synthetic-development-only";
    const f = await disputeFixture();
    const support = `synthetic-dispute-support-${randomUUID()}`;
    await db.insert(valoStaffAssignments).values({
      id: randomUUID(),
      identityId: support,
      role: "support",
      grantedBy: "synthetic",
      reason: "Verify support cannot mutate finance.",
    });
    let active = true,
      verified = true,
      matched = true,
      fresh = true;
    const auth = makeVerifiedStaffSession({
      auth: (req) => {
        const id = req.header("x-test-staff");
        return {
          userId: id ?? null,
          sessionId: id ? `session:${id}` : null,
          sessionClaims: { fva: fresh ? [0, 0] : [0, -1] },
          has: () => fresh,
        };
      },
      session: async (id) => ({
        status: active ? "active" : "revoked",
        userId: matched ? id.slice(8) : "mismatched",
      }),
      user: async (id) => ({
        id,
        banned: false,
        locked: false,
        twoFactorEnabled: true,
        primaryEmailAddressId: "primary",
        emailAddresses: [{ id: "primary", verification: { status: verified ? "verified" : "unverified" } }],
      }),
    });
    const app = express();
    app.use(express.json());
    app.use(createFinancePaymentConcernsRouter(auth));
    app.use(makeDisputeOperationsRouter(auth));
    app.use((req, res, next) => {
      const who = req.header("x-test-customer");
      if (who !== "owner" && who !== "other") {
        res.status(401).json({ error: "Controlled customer required" });
        return;
      }
      res.locals.valoActor = who === "owner" ? f.owner : f.other;
      next();
    }, customerPaymentConcernsRouter);
    app.use((e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res
        .status(e instanceof ValoProblem ? e.status : e instanceof z.ZodError ? 422 : 503)
        .json({ error: e instanceof Error ? e.message : "Unavailable" }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("LISTENER_REQUIRED");
    const base = `http://127.0.0.1:${address.port}`,
      oldOrigin = process.env.VALO_TRUSTED_ORIGIN;
    process.env.VALO_TRUSTED_ORIGIN = base;
    const request = (path: string, identity: string | undefined, body?: unknown, origin = base) =>
      fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(identity ? { "x-test-staff": identity } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    try {
      await t.test(
        "anonymous, support, stale MFA, revoked and mismatched sessions are denied before existence disclosure",
        async () => {
          assert.equal((await request("/admin/payment-concerns", undefined)).status, 401);
          assert.equal((await request("/admin/payment-concerns", support)).status, 403);
          for (const key of ["active", "verified", "matched", "fresh"]) {
            if (key === "active") active = false;
            if (key === "verified") verified = false;
            if (key === "matched") matched = false;
            if (key === "fresh") fresh = false;
            assert.equal((await request("/admin/payment-concerns", f.staff.identityId)).status, 403);
            active = verified = matched = fresh = true;
          }
          assert.equal((await request("/admin/payment-concerns", f.staff.identityId)).status, 200);
          const res = await request("/admin/payment-concerns", f.staff.identityId);
          assert.match(res.headers.get("cache-control") ?? "", /no-store/);
        },
      );
      await t.test(
        "customer route binds the active workspace; public provider facts cannot be submitted",
        async () => {
          const send = (who: string, body: unknown) =>
            fetch(`${base}/workspace/orders/${f.order.id}/concerns`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Origin: base, "x-test-customer": who },
              body: JSON.stringify(body),
            });
          const body = {
            requestKey: randomUUID(),
            message: "Controlled customer concern through the real HTTP route.",
            acknowledgement: true,
          };
          assert.equal((await send("other", body)).status, 404);
          assert.equal((await send("owner", { ...body, providerId: f.providerId })).status, 422);
          const created = await send("owner", body);
          assert.equal(created.status, 200);
          assert.match(created.headers.get("cache-control") ?? "", /no-store/);
        },
      );
      await t.test(
        "cross-origin finance mutation and default provider dispatch are blocked; saved intent remains unsent",
        async () => {
          const d = await linkFinanceDispute(
            f.staff,
            { orderId: f.order.id, providerId: f.providerId },
            f.provider,
          );
          const prepared = await prepareDisputeAction(f.staff, d.id, {
            kind: "merchant_decision",
            message: "Controlled acceptance of a partial test amount.",
            requestKey: randomUUID(),
            resolution: "merchant-accepted",
            amountKobo: 1000,
          });
          const path = `/admin/dispute-actions/${prepared.actions[0]!.id}/execute`,
            body = { expectedVersion: prepared.actions[0]!.version, acknowledgement: true };
          assert.equal(
            (await request(path, f.staff.identityId, body, "https://untrusted.invalid")).status,
            403,
          );
          assert.equal((await request(path, f.staff.identityId, body)).status, 503);
          assert.equal((await financeDispute(f.staff, d.id)).actions[0]!.status, "prepared");
          assert.equal(f.counters().puts, 0);
          await db
            .update(valoStaffAssignments)
            .set({ active: false })
            .where(eq(valoStaffAssignments.id, f.role));
          assert.equal((await request(path, f.staff.identityId, body)).status, 403);
        },
      );
    } finally {
      process.env.VALO_TRUSTED_ORIGIN = oldOrigin;
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      await pool.end();
    }
  },
);
