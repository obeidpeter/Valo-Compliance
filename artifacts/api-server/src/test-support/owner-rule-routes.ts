import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ListOwnerRulesResponse } from "@workspace/api-zod";
import { ownerConfirmedChecks, sha256 } from "@workspace/valo-core";

type Call = (
  path: string,
  body?: unknown,
  actor?: string,
  headers?: Record<string, string>,
) => Promise<Response>;

/**
 * The checker rule sign-off routes behind the staff gate (decision 0020): only the recently verified
 * development owner reaches them, and only from Valo's own pages. The owner sees the rules prepared in
 * the repository, each held here because this database holds no checked copy of their official
 * sources, so none can be signed through the routes here; the service's own test signs synthetic
 * rules.
 */
export async function exerciseOwnerRuleRoutes(call: Call, editor: string) {
  const { db, valoStaffAssignments: roles, valoStaffRoleChanges: audit } = await import("@workspace/db");
  const id = randomUUID(),
    owner = "synthetic-rule-route-owner-" + id,
    system = "synthetic-rule-route-system-" + id,
    assignment = randomUUID();
  await db.insert(roles).values(
    [
      { id: assignment, identityId: owner },
      { id: randomUUID(), identityId: system },
    ].map((row) => ({
      ...row,
      role: "system" as const,
      grantedBy: "synthetic operator",
      reason: "Synthetic rule route test",
    })),
  );
  await db.insert(audit).values({
    id: randomUUID(),
    requestKey: randomUUID(),
    inputHash: sha256("synthetic"),
    actorId: "operator-bootstrap:synthetic",
    actorAssignmentId: assignment,
    assignmentId: assignment,
    targetIdentityId: owner,
    action: "grant",
    role: "system",
    reason: "Synthetic rule owner fixture",
    after: { active: true },
    targetVerifiedAt: new Date(),
  });
  try {
    const path = "/admin/owner-rules";
    assert.equal((await call(path, undefined, editor)).status, 403);
    assert.equal((await call(path, undefined, system)).status, 403);
    assert.equal((await call(path, undefined, owner, { "x-test-mfa": "stale" })).status, 403);
    const listed = await call(path, undefined, owner);
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("cache-control"), "private, no-store");
    const { items } = ListOwnerRulesResponse.parse(await listed.json());
    assert.deepEqual(items.map((item) => item.ruleId).sort(), [
      "cac-business-name-814",
      "nafdac-f33-product-registration",
      "ndpa-27-collection-information",
      "ntaa-11-company-return",
    ]);
    for (const item of items) {
      // Nothing is released, nothing can be signed, and a calculated rule's customer words are in its
      // scenarios rather than in a reason of its own.
      assert.equal(item.live, null, item.ruleId);
      assert.equal(item.version, 1, item.ruleId);
      assert.ok(item.holds.length > 0, item.ruleId);
      assert.equal(item.reason, null, item.ruleId);
    }

    const decision = {
      action: "sign",
      version: 1,
      manifestHash: "a".repeat(64),
      confirmedChecks: [...ownerConfirmedChecks],
      confirmed: true,
    };
    const decide = (rule: string, body: unknown, actor = owner, extra: Record<string, string> = {}) =>
      call(`${path}/${rule}/decisions`, body, actor, extra);
    const other = { origin: "https://other.example.invalid" };
    assert.equal((await decide("synthetic-not-prepared", decision, owner, other)).status, 403);
    assert.equal(
      (await decide("synthetic-not-prepared", decision, owner, { "x-test-mfa": "stale" })).status,
      403,
    );
    assert.equal((await decide("synthetic-not-prepared", decision, editor)).status, 403);
    assert.equal((await decide("synthetic-not-prepared", decision, system)).status, 403);
    assert.equal((await decide("synthetic-not-prepared", decision)).status, 404);
    assert.equal((await decide(encodeURIComponent("not a rule!"), decision)).status, 404);
    assert.equal((await decide("synthetic-not-prepared", { ...decision, confirmed: false })).status, 422);
    assert.equal((await decide("synthetic-not-prepared", { ...decision, action: "publish" })).status, 422);

    const watch = (rule: string, body: unknown, actor = owner, extra: Record<string, string> = {}) =>
      call(`${path}/${rule}/source-watches`, body, actor, extra);
    assert.equal(
      (await watch("synthetic-not-prepared", { watch: "official_sources" }, owner, other)).status,
      403,
    );
    assert.equal((await watch("synthetic-not-prepared", { watch: "official_sources" }, system)).status, 403);
    assert.equal((await watch("synthetic-not-prepared", { watch: "official_sources" })).status, 404);
    assert.equal((await watch("synthetic-not-prepared", { watch: "everything" })).status, 422);
  } finally {
    for (const identity of [owner, system])
      await db.update(roles).set({ active: false }).where(eq(roles.identityId, identity));
  }
}
