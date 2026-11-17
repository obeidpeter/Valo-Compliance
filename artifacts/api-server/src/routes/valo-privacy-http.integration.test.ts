import { test } from "node:test";
import { sql } from "drizzle-orm";
import { GetPrivacyCaseResponse, ListPrivacyCasesResponse } from "@workspace/api-zod";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  valoStaffAssignments,
  valoPrivacyCases,
  valoPrivacyEvents,
  valoPrivacyTombstones,
  valoPrivacyErasureObjects,
  valoStaffAccessAudit,
  valoWorkspaces,
  valoMemberships,
  valoSupportTickets,
  valoEvents,
} from "@workspace/db";
import {
  createPrivacyOperationsRouter,
  createPrivacyRequesterRouter,
  makeVerifiedStaffSession,
  customerAccessRouter,
} from "./valo-customer-access";
import { createPrivacyCase, confirmPrivacyCase } from "../lib/valo-privacy";
import { resolveWorkspace, ValoProblem } from "../lib/valo-store";

test(
  "actual HTTP privacy routes apply an independent privacy role and fresh MFA",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 30000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const tag = randomUUID(),
      owner = await resolveWorkspace(`synthetic-http-privacy-${tag}`);
    const other = await resolveWorkspace(`synthetic-http-other-${tag}`);
    const quarantinedOwner = await resolveWorkspace(`synthetic-http-quarantine-${tag}`);
    const roles = ["privacy", "finance", "revoked", "stale"].map((x) => `synthetic-http-${x}-${tag}`);
    let sessionRevoked = false,
      emailVerified = true,
      sessionMismatch = false;
    const app = express();
    app.use(express.json());
    let requesterRevoked = false;
    app.use(
      "/customer/workspace/privacy-cases",
      createPrivacyRequesterRouter(
        makeVerifiedStaffSession({
          auth: (req) => {
            const selected = req.header("x-test-customer"),
              id =
                selected === "owner"
                  ? owner.identityId
                  : selected === "other"
                    ? other.identityId
                    : selected === "quarantined"
                      ? quarantinedOwner.identityId
                      : null;
            return { userId: id, sessionId: id ? `requester:${id}` : null, has: () => false };
          },
          session: async (id) => ({
            status: requesterRevoked ? "revoked" : "active",
            userId: id.slice("requester:".length),
          }),
          user: async (id) => ({
            id,
            banned: false,
            locked: false,
            primaryEmailAddressId: "primary",
            emailAddresses: [{ id: "primary", verification: { status: "verified" } }],
          }),
        }),
      ),
    );
    app.use(
      "/customer",
      (req, res, next) => {
        // Explicit controlled fixture identity transport, never production auth.
        const selected = req.header("x-test-customer");
        if (selected !== "owner" && selected !== "other") {
          res.status(401).json({ message: "Controlled customer identity required" });
          return;
        }
        res.locals.valoActor = selected === "owner" ? owner : other;
        res.locals.valoContactEmail = "synthetic@example.invalid";
        next();
      },
      customerAccessRouter,
    );
    app.use(
      "/admin/privacy-cases",
      createPrivacyOperationsRouter(
        makeVerifiedStaffSession({
          auth: (req) => {
            const raw = req.header("x-test-identity"),
              id = raw && roles.includes(raw) ? raw : null;
            return {
              userId: id,
              sessionId: id ? `controlled-session:${id}` : null,
              sessionClaims: { fva: id && !id.includes("stale") ? [0, 0] : [0, -1] },
              has: () => Boolean(id && !id.includes("stale")),
            };
          },
          session: async (id) => ({
            status: sessionRevoked ? "revoked" : "active",
            userId: sessionMismatch ? "different-user" : id.slice("controlled-session:".length),
          }),
          user: async (id) => ({
            id,
            banned: false,
            locked: false,
            twoFactorEnabled: true,
            primaryEmailAddressId: "controlled-primary",
            emailAddresses: [
              {
                id: "controlled-primary",
                verification: { status: emailVerified ? "verified" : "unverified" },
              },
            ],
          }),
        }),
      ),
    );
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res
        .status(err instanceof ValoProblem ? err.status : 503)
        .json({ error: err instanceof Error ? err.message : "unavailable" });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("HTTP_LISTENER_UNAVAILABLE");
    const base = `http://127.0.0.1:${address.port}`;
    const previousOrigin = process.env.VALO_TRUSTED_ORIGIN;
    process.env.VALO_TRUSTED_ORIGIN = base;
    let caseId = "";
    try {
      for (const [index, role] of (["privacy", "finance", "privacy", "privacy"] as const).entries()) {
        await db.insert(valoStaffAssignments).values({
          id: randomUUID(),
          identityId: roles[index],
          role,
          active: index !== 2,
          grantedBy: "controlled-fixture",
          reason: "HTTP role-separation regression",
        });
      }
      const created = await createPrivacyCase(owner, "synthetic@example.invalid", {
        kind: "deletion",
        idempotencyKey: randomUUID(),
        message: "Controlled HTTP privacy request.",
        acknowledgement: true,
      });
      caseId = created.reference.slice(5);
      let beforeVerification = 1;
      await t.test("information replies do not substitute for owner verification", async () => {
        const ask = await fetch(`${base}/admin/privacy-cases/${caseId}/action`, {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/json", "x-test-identity": roles[0] },
          body: JSON.stringify({
            action: "request_information",
            expectedVersion: 1,
            reason: "Clarify the scope before owner verification.",
          }),
        });
        const waiting = GetPrivacyCaseResponse.parse(await ask.json());
        assert.equal(ask.status, 200);
        const reply = (message: string) =>
          fetch(`${base}/customer/workspace/privacy-cases/${caseId}/respond`, {
            method: "POST",
            headers: { Origin: base, "Content-Type": "application/json", "x-test-customer": "owner" },
            body: JSON.stringify({ expectedVersion: waiting.request.version, message }),
          });
        assert.equal((await reply("          ")).status, 422);
        const response = await reply("Controlled scope clarification; this does not confirm identity.");
        const answered = GetPrivacyCaseResponse.parse(await response.json());
        assert.equal(response.status, 200);
        assert.equal(answered.request.status, "awaiting_verification");
        assert.equal(answered.request.verifiedAt, null);
        beforeVerification = answered.request.version;
      });
      const verified = await confirmPrivacyCase(owner, caseId, {
        expectedVersion: beforeVerification,
        acknowledgement: true,
      });
      const request = (identity?: string, method = "GET", body?: object, origin = base) =>
        fetch(`${base}/admin/privacy-cases${method === "POST" ? `/${caseId}/action` : ""}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            ...(identity ? { "x-test-identity": identity } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      await t.test("privacy-only identity can read and claim; finance-only cannot", async () => {
        assert.equal((await request()).status, 401);
        assert.equal((await request(roles[1])).status, 403);
        assert.equal((await request(roles[0])).status, 200);
        const res = await request(roles[0], "POST", {
          action: "claim",
          expectedVersion: verified.request.version,
          reason: "Assigned to a controlled privacy-only operator.",
        });
        assert.equal(res.status, 200);
        const detail = (await res.json()) as { request: { status: string; version: number } };
        assert.equal(detail.request.status, "assigned");
        assert.equal(
          (
            await request(roles[1], "POST", {
              action: "hold",
              expectedVersion: detail.request.version,
              reason: "Finance must not control privacy requests.",
            })
          ).status,
          403,
        );
      });
      await t.test(
        "read-only inspection and customer replies preserve verification and deduplicate actual HTTP writes",
        async () => {
          const inspect = () =>
            fetch(`${base}/admin/privacy-cases/${caseId}`, { headers: { "x-test-identity": roles[0] } });
          const initial = GetPrivacyCaseResponse.parse(await (await inspect()).json());
          assert.ok(initial.availableActions?.includes("request_information"));
          assert.ok(initial.availableActions?.includes("start_erasure"));
          const version = initial.request.version,
            verifiedAt = initial.request.verifiedAt;
          assert.equal(GetPrivacyCaseResponse.parse(await (await inspect()).json()).request.version, version);
          assert.equal(
            (
              await fetch(`${base}/admin/privacy-cases/${caseId}`, {
                headers: { "x-test-identity": roles[1] },
              })
            ).status,
            403,
          );
          const ask = await request(roles[0], "POST", {
            action: "request_information",
            expectedVersion: version,
            reason: "Please describe the exact synthetic data scope to remove.",
          });
          const waiting = GetPrivacyCaseResponse.parse(await ask.json());
          assert.equal(ask.status, 200);
          assert.equal(waiting.mayRespond, true);
          const message = "SYNTHETIC-PRIVATE-REPLY: remove the draft profile and generated files only.";
          assert.equal(
            (
              await fetch(`${base}/customer/workspace/privacy-cases/${caseId}/respond`, {
                method: "POST",
                headers: { Origin: base, "Content-Type": "application/json", "x-test-customer": "other" },
                body: JSON.stringify({ expectedVersion: waiting.request.version, message }),
              })
            ).status,
            404,
          );
          const reply = (body: object, id = caseId) =>
            fetch(`${base}/customer/workspace/privacy-cases/${id}/respond`, {
              method: "POST",
              headers: { Origin: base, "Content-Type": "application/json", "x-test-customer": "owner" },
              body: JSON.stringify(body),
            });
          const repeated = await Promise.all([
            reply({ expectedVersion: waiting.request.version, message }),
            reply({ expectedVersion: waiting.request.version, message }),
          ]);
          assert.ok(repeated.every((r) => r.status === 200));
          const answered = GetPrivacyCaseResponse.parse(await repeated[0].json());
          assert.equal(answered.request.status, "assigned");
          assert.equal(answered.request.verifiedAt, verifiedAt);
          assert.equal(answered.messages.length, 2);
          assert.equal(answered.messages.filter((m: { body: string }) => m.body === message).length, 1);
          assert.ok(
            answered.events.every((e: { reason: string }) => !e.reason.includes("SYNTHETIC-PRIVATE-REPLY")),
          );
          assert.equal(
            (
              await reply({
                expectedVersion: waiting.request.version,
                message: "A different stale reply must not silently replace the first one.",
              })
            ).status,
            409,
          );
          const inspected = GetPrivacyCaseResponse.parse(await (await inspect()).json());
          assert.equal(inspected.messages.filter((m: { body: string }) => m.body === message).length, 1);
        },
      );
      await t.test(
        "quarantined verified requester can answer without restored workspace membership",
        async () => {
          const created = await createPrivacyCase(quarantinedOwner, "synthetic@example.invalid", {
            kind: "deletion",
            idempotencyKey: randomUUID(),
            message: "Fresh post-quarantine HTTP fixture, distinct from quota/race fixtures.",
            acknowledgement: true,
          });
          const id = created.reference.slice(5);
          const verified = await confirmPrivacyCase(quarantinedOwner, id, {
            expectedVersion: 1,
            acknowledgement: true,
          });
          const action = (data: object) =>
            fetch(`${base}/admin/privacy-cases/${id}/action`, {
              method: "POST",
              headers: { Origin: base, "Content-Type": "application/json", "x-test-identity": roles[0] },
              body: JSON.stringify(data),
            });
          const claimed = await action({
            action: "claim",
            expectedVersion: verified.request.version,
            reason: "Assign the independent synthetic quarantine fixture.",
          });
          assert.equal(claimed.status, 200);
          const before = GetPrivacyCaseResponse.parse(await claimed.json());
          const started = await action({
            action: "start_erasure",
            expectedVersion: before.request.version,
            acknowledgement: true,
            reason: "Quarantine only this fresh synthetic HTTP fixture.",
          });
          assert.equal(started.status, 200);
          const quarantined = GetPrivacyCaseResponse.parse(await started.json());
          const asked = await action({
            action: "request_information",
            expectedVersion: quarantined.request.version,
            reason: "Clarify the retained processing scope after workspace quarantine.",
          });
          assert.equal(asked.status, 200);
          const waiting = GetPrivacyCaseResponse.parse(await asked.json());
          const read = (customer: string) =>
            fetch(`${base}/customer/workspace/privacy-cases/${id}`, {
              headers: { "x-test-customer": customer },
            });
          assert.equal((await read("other")).status, 404);
          requesterRevoked = true;
          assert.equal((await read("quarantined")).status, 403);
          requesterRevoked = false;
          const visible = GetPrivacyCaseResponse.parse(await (await read("quarantined")).json());
          assert.equal(visible.mayRespond, true);
          const listed = await fetch(`${base}/customer/workspace/privacy-cases`, {
            headers: { "x-test-customer": "quarantined" },
          });
          assert.equal(listed.status, 200);
          const cases = ListPrivacyCasesResponse.parse(await listed.json());
          assert.deepEqual(
            cases.map((c) => c.id),
            [id],
          );
          const send = () =>
            fetch(`${base}/customer/workspace/privacy-cases/${id}/respond`, {
              method: "POST",
              headers: { Origin: base, "Content-Type": "application/json", "x-test-customer": "quarantined" },
              body: JSON.stringify({
                expectedVersion: waiting.request.version,
                message: "Please retain only the minimum processing evidence.",
              }),
            });
          const response = await send();
          assert.equal(response.status, 200);
          const answered = GetPrivacyCaseResponse.parse(await response.json());
          assert.equal(answered.request.status, "assigned");
          assert.equal((await send()).status, 200);
          const members = await db
            .select()
            .from(valoMemberships)
            .where(eq(valoMemberships.workspaceId, quarantinedOwner.workspaceId));
          assert.equal(
            members.every((m) => m.active === "no"),
            true,
          );
        },
      );
      await t.test("revoked and stale-MFA privacy identities fail on the HTTP route", async () => {
        assert.equal((await request(roles[2])).status, 403);
        assert.equal((await request(roles[3])).status, 403);
        sessionRevoked = true;
        assert.equal((await request(roles[0])).status, 403);
        sessionRevoked = false;
        emailVerified = false;
        assert.equal((await request(roles[0])).status, 403);
        emailVerified = true;
        sessionMismatch = true;
        assert.equal((await request(roles[0])).status, 403);
        sessionMismatch = false;
        await db
          .update(valoStaffAssignments)
          .set({ active: false })
          .where(eq(valoStaffAssignments.identityId, roles[0]));
        assert.equal((await request(roles[0])).status, 403);
      });
      await t.test("hostile origin never reaches the privacy mutation", async () => {
        // Isolate the origin boundary: this same actor/session/body must succeed
        // from the configured origin, not fail earlier on role or stale revision.
        await db
          .update(valoStaffAssignments)
          .set({ active: true })
          .where(eq(valoStaffAssignments.identityId, roles[0]));
        const inspect = await fetch(`${base}/admin/privacy-cases/${caseId}`, {
          headers: { "x-test-identity": roles[0] },
        });
        assert.equal(inspect.status, 200);
        const current = GetPrivacyCaseResponse.parse(await inspect.json());
        assert.ok(current.availableActions?.includes("hold"));
        const snapshot = async () => ({
          cases: await db.select().from(valoPrivacyCases).where(eq(valoPrivacyCases.id, caseId)),
          events: await db
            .select()
            .from(valoPrivacyEvents)
            .where(eq(valoPrivacyEvents.caseId, caseId))
            .orderBy(valoPrivacyEvents.sequence),
          access: await db
            .select()
            .from(valoStaffAccessAudit)
            .where(eq(valoStaffAccessAudit.actorId, roles[0])),
        });
        const before = await snapshot(),
          body = {
            action: "hold",
            expectedVersion: current.request.version,
            reason: "Controlled origin-specific privacy transition.",
          };
        const r = await request(roles[0], "POST", body, "https://hostile.synthetic.invalid");
        assert.equal(r.status, 403);
        assert.deepEqual(await snapshot(), before);
        const positive = await request(roles[0], "POST", body, base);
        assert.equal(positive.status, 200);
        const held = GetPrivacyCaseResponse.parse(await positive.json());
        assert.equal(held.request.status, "held");
        assert.equal(held.request.version, current.request.version + 1);
        assert.equal((await snapshot()).events.length, before.events.length + 1);
      });
    } finally {
      await db.execute(
        sql`DELETE FROM valo_privacy_messages WHERE workspace_id IN (${owner.workspaceId}::uuid,${quarantinedOwner.workspaceId}::uuid)`,
      );
      await db.execute(sql`DELETE FROM valo_memberships WHERE workspace_id=${other.workspaceId}::uuid`);
      await db.execute(sql`DELETE FROM valo_workspaces WHERE id=${other.workspaceId}::uuid`);
      if (previousOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = previousOrigin;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      for (const table of [
        valoPrivacyErasureObjects,
        valoPrivacyEvents,
        valoPrivacyTombstones,
        valoPrivacyCases,
        valoSupportTickets,
        valoEvents,
        valoMemberships,
      ])
        await db
          .delete(table)
          .where(inArray(table.workspaceId, [owner.workspaceId, quarantinedOwner.workspaceId]));
      await db.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId, roles));
      await db.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId, roles));
      await db
        .delete(valoWorkspaces)
        .where(inArray(valoWorkspaces.id, [owner.workspaceId, quarantinedOwner.workspaceId]));
      await pool.end();
    }
  },
);
