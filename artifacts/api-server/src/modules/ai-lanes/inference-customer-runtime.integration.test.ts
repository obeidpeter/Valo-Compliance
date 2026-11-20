import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  valoAIDrafts,
  valoSafetySwitches,
  valoEvents,
  valoMemberships,
  valoWorkspaces,
} from "@workspace/db";
import { resolveWorkspace } from "../workspaces";
import { prepareCustomerEvaluationPlan } from "./inference-customer-evaluation";
import { existingCustomerEvaluationActor, assertCustomerEvaluationActor } from "./inference-customer-runtime";
import { hashAI, customerPromptVersion, customerNoticeVersion } from "./valo-customer-ai-domain";

test(
  "real PostgreSQL existing-actor and exact-request holds retain all financial history",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const workspace = await resolveWorkspace(`valo-ai-eval-invoice-negative-${randomUUID()}`),
      anchorId = randomUUID(),
      pendingId = randomUUID();
    const actor = { ...workspace, anchorDraftId: anchorId },
      flagKey = `customer_ai_workspace:${workspace.workspaceId}`;
    try {
      await db.insert(valoAIDrafts).values({
        id: anchorId,
        workspaceId: workspace.workspaceId,
        actorId: workspace.identityId,
        idempotencyKey: randomUUID(),
        inputHash: hashAI({ fixture: anchorId }),
        task: "invoice",
        status: "manual_fallback",
        promptVersion: "controlled-no-outbound-anchor",
        preview: { controlledFixture: true },
        providerRuns: [],
        providerCalls: 0,
        budgetReserved: false,
      });
      assert.deepEqual(await existingCustomerEvaluationActor(), actor);
      const plan = await prepareCustomerEvaluationPlan(actor),
        entry = plan.cases.find((c) => c.caseId === "CAI-CAND-INV-01")!;
      await assertCustomerEvaluationActor(plan, entry);
      await db.insert(valoSafetySwitches).values({
        key: flagKey,
        enabled: false,
        reason: "Owned synthetic no-outbound test",
        actorId: workspace.identityId,
      });
      await assert.rejects(() => assertCustomerEvaluationActor(plan, entry), /SAFETY_SWITCH_HELD/);
      await db
        .delete(valoSafetySwitches)
        .where(
          and(eq(valoSafetySwitches.key, flagKey), eq(valoSafetySwitches.actorId, workspace.identityId)),
        );
      await db
        .update(valoMemberships)
        .set({ active: "no" })
        .where(eq(valoMemberships.workspaceId, workspace.workspaceId));
      await assert.rejects(() => assertCustomerEvaluationActor(plan, entry), /ACTOR_UNAVAILABLE/);
      await db
        .update(valoMemberships)
        .set({ active: "yes" })
        .where(eq(valoMemberships.workspaceId, workspace.workspaceId));
      const { idempotencyKey, ...facts } = entry.input!;
      await db.insert(valoAIDrafts).values({
        id: pendingId,
        workspaceId: workspace.workspaceId,
        actorId: workspace.identityId,
        idempotencyKey,
        inputHash: hashAI(facts),
        providerInputHash: entry.providerInputHash,
        task: "invoice",
        status: "running",
        promptVersion: `${customerPromptVersion}/${customerNoticeVersion}`,
        preview: { controlledFixture: true },
        providerRuns: [],
        providerCalls: 0,
        budgetReserved: false,
        createdAt: new Date(Date.parse(plan.preparedAt) - 10000),
        failureCode: "CONTROLLED_NO_OUTBOUND_UNCERTAINTY_FIXTURE",
      });
      await assert.rejects(() => assertCustomerEvaluationActor(plan, entry), /COMPLETION_UNKNOWN/);
      const retained = await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.id, pendingId));
      assert.equal(retained.length, 1);
      assert.equal(retained[0]!.status, "running");
      assert.deepEqual(retained[0]!.providerRuns, []);
      await db.update(valoAIDrafts).set({ createdAt: new Date() }).where(eq(valoAIDrafts.id, pendingId));
      assert.deepEqual(await assertCustomerEvaluationActor(plan, entry), { reusableExisting: false });
    } finally {
      const rows = await db
        .select()
        .from(valoAIDrafts)
        .where(eq(valoAIDrafts.workspaceId, workspace.workspaceId));
      assert.ok(
        rows.every((row) => row.providerCalls === 0 && row.providerRuns.length === 0),
        "Never delete actual provider usage",
      );
      await db
        .delete(valoSafetySwitches)
        .where(
          and(eq(valoSafetySwitches.key, flagKey), eq(valoSafetySwitches.actorId, workspace.identityId)),
        );
      await db.delete(valoAIDrafts).where(eq(valoAIDrafts.workspaceId, workspace.workspaceId));
      await db.delete(valoEvents).where(eq(valoEvents.workspaceId, workspace.workspaceId));
      await db.delete(valoMemberships).where(eq(valoMemberships.workspaceId, workspace.workspaceId));
      await db.delete(valoWorkspaces).where(eq(valoWorkspaces.id, workspace.workspaceId));
    }
  },
);
test.after(() => pool.end());
