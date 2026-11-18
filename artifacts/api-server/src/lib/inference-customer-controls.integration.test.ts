import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";

test(
  "original customer quota, pause, tenant and outage boundaries use actual PostgreSQL/services with no provider",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async (t) => {
    const { assertDevelopmentRuntime } = await import("./valo-development-runtime");
    assertDevelopmentRuntime();
    let realProviderCalls = 0;
    const forbidden = async () => {
      realProviderCalls++;
      throw Error("REAL_PROVIDER_FORBIDDEN");
    };
    // This isolated test supplies only the financial-context predicate so that
    // quota/kill-switch failures cannot pass because spending is already disabled.
    // Real approval/admission/settlement are tested independently; never write an
    // enabled approval row, and fail if the default transport is attempted.
    t.mock.module(new URL("../modules/ai/managed-inference.ts", import.meta.url).href, {
      namedExports: {
        hasApprovedInferenceContext: () => true,
        managedCompletion: forbidden,
        withApprovedInferenceAttempt: forbidden,
        InferenceHeld: class extends Error {},
      },
    });
    const {
      db,
      pool,
      valoAIDrafts,
      valoSafetySwitches,
      valoDocuments,
      valoDocumentRevisions,
      valoEvents,
      valoMemberships,
      valoWorkspaces,
    } = await import("@workspace/db");
    const { resolveWorkspace, createDocument, getDocument, saveDocument } = await import("./valo-store");
    const { createCustomerAIDraft, customerAIUsage } = await import("./valo-customer-ai");
    const { prepareCustomerEvaluationPlan } = await import("./inference-customer-evaluation");
    const { controlledCustomerFault } = await import("./inference-customer-controls");
    const { organizeCustomerDraft } = await import("./valo-customer-ai-model");
    const { hashAI, customerProviderPayload, customerPreview } = await import("./valo-customer-ai-domain");
    const { buildBusinessDraft } = await import("@workspace/valo-core/customer-document");
    const { documentInput } = await import("./valo-validation");
    const { withWorkspaceDataFile } = await import("../modules/privacy/valo-data-download");
    const run = randomUUID(),
      a = await resolveWorkspace(`synthetic-customer-control-a-${run}`),
      b = await resolveWorkspace(`synthetic-customer-control-b-${run}`),
      ids = [a.workspaceId, b.workspaceId];
    const flagKey = `customer_ai_workspace:${a.workspaceId}`;
    const original = await prepareCustomerEvaluationPlan(null),
      followups: Record<string, Record<string, string>> = {};
    const selected = ["CAI-CAND-QUO-14", "CAI-CAND-REM-15", "CAI-CAND-PRO-11", "CAI-CAND-PRO-15"];
    for (const id of selected) {
      const input = original.cases.find((c) => c.caseId === id)!.input!;
      followups[id] = { issueDate: "2026-11-13" };
      if (!input.documentNumber) followups[id]!.documentNumber = `SYNTHETIC-CONTROL-${id}`;
      if (input.task === "payment_reminder" && !input.dueDate) followups[id]!.dueDate = "2026-11-01";
    }
    const plan = await prepareCustomerEvaluationPlan(null, new Date(), followups);
    const entry = (id: string) => plan.cases.find((c) => c.caseId === id)!;
    const source = entry("CAI-CAND-PRO-15").input!;
    const own = await createDocument(
      a,
      buildBusinessDraft({ ...source, contextLines: ["SYNTHETIC-REVISION-15"] }, null),
    );
    const foreign = await createDocument(
      b,
      buildBusinessDraft({ ...source, contextLines: ["OTHER-TENANT-PRO-011"] }, null),
    );
    let manual = own;
    const manualAndDownload = async (label: string) => {
      const before = await getDocument(a, own.id),
        content = documentInput.parse({ title: before.title, content: before.content });
      content.content.fields.notes += `\nSynthetic ${label} edit.`;
      manual = await saveDocument(a, own.id, { ...content, expectedRevision: before.revision });
      assert.equal(hashAI(manual.content.financialInput), hashAI(before.content.financialInput));
      const saved = documentInput.parse({ title: manual.title, content: manual.content });
      assert.ok(saved.content.fields.notes.includes(`Synthetic ${label} edit.`));
      await withWorkspaceDataFile(a, async (path) => {
        const body = JSON.parse(await readFile(path, "utf8"));
        assert.ok(JSON.stringify(body).includes(own.id));
        assert.ok(!JSON.stringify(body).includes("OTHER-TENANT-PRO-011"));
      });
      // This proves the current authorised JSON download. Native DOCX/PDF object
      // downloads and unsaved browser state are deliberately separate evidence.
    };
    const oldFetch = globalThis.fetch;
    globalThis.fetch = forbidden;
    try {
      const baseline = await customerAIUsage(a);
      assert.equal(baseline.enabled, true);
      assert.ok(baseline.globalAvailable && baseline.workspaceUsed === 0);
      await t.test(
        "CAI-CAND-QUO-14 reaches the real quota gate, preserving manual work and scoped data download",
        async () => {
          const c = entry("CAI-CAND-QUO-14"),
            input = { ...c.input!, idempotencyKey: randomUUID() },
            fixtureIds = Array.from({ length: 30 }, () => randomUUID());
          await db.insert(valoAIDrafts).values(
            fixtureIds.map((id) => ({
              id,
              workspaceId: a.workspaceId,
              actorId: a.identityId,
              idempotencyKey: randomUUID(),
              inputHash: hashAI({ fixture: id }),
              task: "quotation",
              status: "manual_fallback",
              promptVersion: "controlled-no-provider-quota-fixture",
              budgetReserved: true,
              providerCalls: 0,
              providerRuns: [],
              preview: customerPreview(id, input, "manual_fallback", null, hashAI(input), 0, null),
            })),
          );
          try {
            const usage = await customerAIUsage(a);
            assert.ok(
              usage.enabled && usage.globalAvailable && usage.workspaceUsed === usage.workspaceDailyLimit,
            );
            const result = await createCustomerAIDraft(a, input, forbidden);
            assert.equal(result.status, "manual_fallback");
            assert.equal(result.providerCalls, 0);
            assert.equal(realProviderCalls, 0);
            await manualAndDownload("quota");
          } finally {
            await db
              .delete(valoAIDrafts)
              .where(and(inArray(valoAIDrafts.id, fixtureIds), eq(valoAIDrafts.providerCalls, 0)));
          }
        },
      );
      await t.test("CAI-CAND-REM-15 reaches the workspace kill switch with quota available", async () => {
        await db
          .insert(valoSafetySwitches)
          .values({ key: flagKey, enabled: false, reason: "Owned synthetic control", actorId: a.identityId });
        try {
          const usage = await customerAIUsage(a);
          assert.ok(!usage.enabled && usage.globalAvailable && usage.workspaceUsed === 0);
          const result = await createCustomerAIDraft(
            a,
            { ...entry("CAI-CAND-REM-15").input!, idempotencyKey: randomUUID() },
            forbidden,
          );
          assert.equal(result.status, "manual_fallback");
          assert.equal(result.providerCalls, 0);
          await manualAndDownload("pause");
        } finally {
          await db
            .delete(valoSafetySwitches)
            .where(and(eq(valoSafetySwitches.key, flagKey), eq(valoSafetySwitches.actorId, a.identityId)));
        }
      });
      await t.test(
        "CAI-CAND-PRO-11 uses only selected context and rejects other-tenant document access",
        async () => {
          await assert.rejects(() => getDocument(a, foreign.id), { status: 404 });
          const c = entry("CAI-CAND-PRO-11"),
            input = { ...c.input!, idempotencyKey: randomUUID() };
          let captured: unknown = null;
          const preview = await createCustomerAIDraft(a, input, (current) =>
            organizeCustomerDraft(current, async (payload) => {
              captured = payload;
              return {
                id: "controlled-no-provider-tenant",
                model: "controlled-no-provider",
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        opening: "none",
                        sections: [{ heading: "notes", lineIndexes: current.contextLines.map((_, i) => i) }],
                      }),
                    },
                  },
                ],
              };
            }),
          );
          assert.equal(hashAI(captured), hashAI(customerProviderPayload(input)));
          assert.ok(!JSON.stringify(captured).includes("OTHER-TENANT-PRO-011"));
          assert.equal(preview.status, "ready");
          assert.equal(preview.providerCalls, 0);
          assert.equal(preview.acceptedDocumentId, null);
          assert.ok(!JSON.stringify(preview).includes("OTHER-TENANT-PRO-011"));
          const events = await db.select().from(valoEvents).where(eq(valoEvents.workspaceId, a.workspaceId));
          assert.ok(!JSON.stringify(events).includes("OTHER-TENANT-PRO-011"));
        },
      );
      await t.test(
        "CAI-CAND-PRO-15 bounds injected outage while real concurrent manual save and data download succeed",
        async () => {
          const c = entry("CAI-CAND-PRO-15"),
            fault = controlledCustomerFault(c),
            before = manual.revision;
          const [preview] = await Promise.all([
            createCustomerAIDraft(a, { ...c.input!, idempotencyKey: randomUUID() }, (input) =>
              organizeCustomerDraft(input, fault.invoke),
            ),
            manualAndDownload("outage"),
          ]);
          assert.equal(fault.count(), 1);
          assert.equal(preview.status, "manual_fallback");
          assert.equal(preview.providerCalls, 0);
          assert.equal(preview.acceptedDocumentId, null);
          assert.equal(manual.revision, before + 1);
          assert.ok(JSON.stringify((await getDocument(a, own.id)).content).includes("SYNTHETIC-REVISION-15"));
        },
      );
      assert.equal(realProviderCalls, 0);
    } finally {
      globalThis.fetch = oldFetch;
      const rows = await db.select().from(valoAIDrafts).where(inArray(valoAIDrafts.workspaceId, ids));
      assert.ok(
        rows.every(
          (row) => row.providerCalls === 0 && row.providerRuns.every((run) => run.outboundAttempted !== true),
        ),
        "Never remove real provider usage",
      );
      await db
        .delete(valoSafetySwitches)
        .where(and(eq(valoSafetySwitches.key, flagKey), eq(valoSafetySwitches.actorId, a.identityId)));
      await db.delete(valoAIDrafts).where(inArray(valoAIDrafts.workspaceId, ids));
      await db.delete(valoDocumentRevisions).where(inArray(valoDocumentRevisions.workspaceId, ids));
      await db.delete(valoDocuments).where(inArray(valoDocuments.workspaceId, ids));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, ids));
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, ids));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, ids));
      await pool.end();
    }
  },
);
