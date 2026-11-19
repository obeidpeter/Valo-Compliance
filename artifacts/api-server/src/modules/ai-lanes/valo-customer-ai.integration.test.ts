import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  valoAIDrafts,
  valoDocuments,
  valoDocumentRevisions,
  valoEvents,
  valoMemberships,
  valoWorkspaces,
} from "@workspace/db";
import {
  createCustomerAIDraft,
  getCustomerAIDraft,
  acceptCustomerAIDraft,
  customerAIUsage,
} from "./valo-customer-ai";
import { customerAICases } from "./valo-customer-ai-fixtures";
import { resolveWorkspace, createDocument, saveDocument } from "../../lib/valo-store";
import { buildBusinessDraft } from "@workspace/valo-core/customer-document";
import { documentInput } from "../../lib/valo-validation";
test(
  "development AI persistence, private ownership, atomic acceptance and quotas",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const a = await resolveWorkspace(`valo-ai-db-negative-a-${randomUUID()}`);
    const b = await resolveWorkspace(`valo-ai-db-negative-b-${randomUUID()}`);
    const ids = [a.workspaceId, b.workspaceId];
    const input = {
      ...structuredClone(customerAICases[0]!.input),
      idempotencyKey: randomUUID(),
      issuerName: "",
    };
    let preview = await createCustomerAIDraft(a, input);
    try {
      await t.test("missing information persists privately without an outbound call", async () => {
        assert.equal(preview.status, "needs_information");
        assert.equal(preview.providerCalls, 0);
        const loaded = await getCustomerAIDraft(a, preview.id);
        assert.equal(loaded.previewHash, preview.previewHash);
        assert.deepEqual(loaded.content, preview.content);
      });
      await t.test("other tenant IDs and forged actor membership fail", async () => {
        await assert.rejects(getCustomerAIDraft(b, preview.id), { status: 404 });
        await assert.rejects(
          acceptCustomerAIDraft(b, preview.id, {
            title: preview.title,
            content: preview.content,
            confirmBusinessDraft: true,
          }),
          { status: 404 },
        );
        await assert.rejects(getCustomerAIDraft({ ...a, identityId: b.identityId }, preview.id), {
          status: 403,
        });
      });
      await t.test("consent and request shape are checked before persistence", async () => {
        await assert.rejects(createCustomerAIDraft(a, { ...input, processingConsent: false }));
        await assert.rejects(createCustomerAIDraft(a, { ...input, tools: ["payment"] }));
        const [total] = await db
          .select({ n: count() })
          .from(valoAIDrafts)
          .where(eq(valoAIDrafts.workspaceId, a.workspaceId));
        assert.equal(total!.n, 1);
      });
      await t.test("same request is idempotent; changed facts cannot reuse its key", async () => {
        assert.equal((await createCustomerAIDraft(a, input)).id, preview.id);
        await assert.rejects(
          createCustomerAIDraft(a, { ...input, recipientName: "Changed synthetic recipient" }),
          { status: 409 },
        );
      });
      const selection = {
        title: preview.title,
        content: {
          ...preview.content,
          fields: { ...preview.content.fields, issuerName: "Synthetic manually supplied business" },
        },
        confirmBusinessDraft: true,
      };
      let saved: Awaited<ReturnType<typeof acceptCustomerAIDraft>>;
      await t.test("concurrent acceptance creates one real document and one revision", async () => {
        const [left, right] = await Promise.all([
          acceptCustomerAIDraft(a, preview.id, selection),
          acceptCustomerAIDraft(a, preview.id, selection),
        ]);
        assert.equal(left.id, right.id);
        saved = left;
        const [total] = await db
          .select({ n: count() })
          .from(valoDocuments)
          .where(eq(valoDocuments.workspaceId, a.workspaceId));
        assert.equal(total!.n, 1);
        const [revision] = await db
          .select()
          .from(valoDocumentRevisions)
          .where(eq(valoDocumentRevisions.documentId, left.id));
        assert.equal(revision!.origin, "manual");
      });
      await t.test("changed acceptance cannot silently overwrite the existing document", async () => {
        await assert.rejects(
          acceptCustomerAIDraft(a, preview.id, { ...selection, title: "Different synthetic title" }),
          { status: 409 },
        );
      });
      await t.test("derived totals cannot be altered or their financial model stripped", async () => {
        const original = documentInput.parse({ title: saved!.title, content: saved!.content });
        const content = structuredClone(original.content);
        content.blocks.find((block) => block.id === "financial-summary-v1")!.rows.at(-1)![1] = "₦999.00";
        await assert.rejects(
          saveDocument(a, saved!.id, { title: saved!.title, content, expectedRevision: saved!.revision }),
        );
        const { financialInput: _financial, ...stripped } = original.content;
        await assert.rejects(
          saveDocument(a, saved!.id, {
            title: saved!.title,
            content: stripped,
            expectedRevision: saved!.revision,
          }),
          { status: 422 },
        );
      });
      await t.test("database composite FK independently rejects a foreign accepted document", async () => {
        const foreign = await createDocument(b, buildBusinessDraft(customerAICases[0]!.input, null));
        await assert.rejects(
          db.transaction((tx) =>
            tx
              .update(valoAIDrafts)
              .set({ acceptedDocumentId: foreign.id })
              .where(and(eq(valoAIDrafts.id, preview.id), eq(valoAIDrafts.workspaceId, a.workspaceId))),
          ),
          (e: unknown) => (e as { cause?: { code: string } }).cause?.code === "23503",
        );
      });
      await t.test(
        "interrupted request becomes an honest manual fallback, not a fabricated completion",
        async () => {
          const stalled = await createCustomerAIDraft(a, { ...input, idempotencyKey: randomUUID() });
          await db
            .update(valoAIDrafts)
            .set({
              status: "running",
              createdAt: new Date(Date.now() - 91000),
              preview: { ...stalled, status: "running", providerCalls: null },
            })
            .where(eq(valoAIDrafts.id, stalled.id));
          const recovered = await getCustomerAIDraft(a, stalled.id);
          assert.equal(recovered.status, "manual_fallback");
          assert.equal(recovered.providerCalls, null);
          assert.equal(recovered.modelUsed, null);
        },
      );
      await t.test(
        "disabled shared spending gate rejects concurrent requests without consuming daily allowance",
        async () => {
          let adapterCalls = 0;
          const requests = await Promise.all(
            Array.from({ length: 34 }, () =>
              createCustomerAIDraft(
                a,
                {
                  ...customerAICases[0]!.input,
                  idempotencyKey: randomUUID(),
                },
                async () => {
                  adapterCalls++;
                  throw Error("Controlled negative transport, never a real provider call");
                },
              ),
            ),
          );
          assert.equal(adapterCalls, 0);
          assert.ok(requests.every((p) => p.status === "manual_fallback" && p.providerCalls === 0));
          assert.equal((await customerAIUsage(a)).workspaceUsed, 0);
          assert.equal((await customerAIUsage(a)).workspaceDailyLimit, 30);
          assert.equal((await customerAIUsage(a)).enabled, false);
          assert.equal((await customerAIUsage(b)).workspaceUsed, 0);
        },
      );
    } finally {
      // Only owned negative fixtures, never the retained real-provider evaluation or another workspace.
      const runs = await db.select().from(valoAIDrafts).where(inArray(valoAIDrafts.workspaceId, ids));
      assert.ok(
        runs.every((r) => !r.providerRuns.some((x) => x.outboundAttempted === true)),
        "Never erase actual provider-cost evidence",
      );
      await db.transaction(async (tx) => {
        await tx.delete(valoAIDrafts).where(inArray(valoAIDrafts.workspaceId, ids));
        await tx.delete(valoDocumentRevisions).where(inArray(valoDocumentRevisions.workspaceId, ids));
        await tx.delete(valoDocuments).where(inArray(valoDocuments.workspaceId, ids));
        await tx.delete(valoEvents).where(inArray(valoEvents.workspaceId, ids));
        await tx.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, ids));
        await tx.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, ids));
      });
    }
  },
);
test.after(() => pool.end());
