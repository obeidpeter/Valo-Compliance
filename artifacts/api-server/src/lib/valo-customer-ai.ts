import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { valoAIDrafts, valoSafetySwitches } from "@workspace/db";
import {
  AcceptCustomerAIDraftBody,
  CreateCustomerAIDraftResponse,
  GetCustomerAIUsageResponse,
} from "@workspace/api-zod";
import {
  customerAIInput,
  customerNoticeVersion,
  customerPromptVersion,
  customerPreview,
  hashAI,
  missingCustomerFields,
  unsupportedCustomerInput,
  type CustomerPreview,
} from "./valo-customer-ai-domain";
import { organizeCustomerDraft } from "./valo-customer-ai-model";
import { workspaceTransaction, workspaceEvent, type WorkspaceTx } from "./valo-assessments";
import { createDocumentInTransaction, getDocument, ValoProblem, type WorkspaceActor } from "./valo-store";
import { documentInput } from "./valo-validation";
import { hasApprovedInferenceContext } from "../modules/ai";
import { assertDevelopmentRuntime } from "./valo-development-runtime";
const workspaceDailyLimit = 30;
/** Customer AI reservations allowed per day across every workspace. */
export const globalDailyLimit = 120;
async function enabled(tx: WorkspaceTx, workspaceId: string) {
  if (!hasApprovedInferenceContext("customer")) return false;
  // No customer or model input can enable this; production remains off even if a development switch is copied.
  try {
    assertDevelopmentRuntime();
  } catch {
    return false;
  }
  // A workspace may be additionally paused; it can never override a global or
  // production pause. Resolving this key uses the authorised server workspace.
  const flags = await tx
    .select()
    .from(valoSafetySwitches)
    .where(
      inArray(valoSafetySwitches.key, ["all_ai", "customer_ai", `customer_ai_workspace:${workspaceId}`]),
    );
  return flags.every((flag) => flag.enabled);
}
async function budget(tx: WorkspaceTx, workspaceId: string, identityId: string, now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  // The shared daily ceiling and each person's per-minute limit count every workspace's
  // reservations. A customer request sees only its own workspace's drafts, so those two
  // totals come from a database function that returns nothing else.
  const shared = await tx.execute<{ global_today: number; identity_last_minute: number }>(
    sql`select global_today, identity_last_minute
      from valo_customer_ai_reservations(${start}, ${new Date(now.getTime() - 60000)}, ${identityId})`,
  );
  const [own] = await tx
    .select({ n: count() })
    .from(valoAIDrafts)
    .where(
      and(
        eq(valoAIDrafts.budgetReserved, true),
        eq(valoAIDrafts.workspaceId, workspaceId),
        gte(valoAIDrafts.createdAt, start),
      ),
    );
  const totals = shared.rows[0]!;
  return {
    workspaceUsed: own!.n,
    globalUsed: totals.global_today,
    userMinuteUsed: totals.identity_last_minute,
  };
}
export function serializeAIPreview(row: typeof valoAIDrafts.$inferSelect) {
  const p = CreateCustomerAIDraftResponse.parse(row.preview);
  if (p.id !== row.id || hashAI({ title: p.title, content: p.content }) !== p.previewHash)
    throw new ValoProblem(
      503,
      "AI preview integrity check failed. Your existing documents remain available.",
    );
  return { ...p, acceptedDocumentId: row.acceptedDocumentId };
}
export async function customerAIUsage(actor: WorkspaceActor) {
  return workspaceTransaction(actor, async (tx) => {
    const b = await budget(tx, actor.workspaceId, actor.identityId);
    return GetCustomerAIUsageResponse.parse({
      enabled: await enabled(tx, actor.workspaceId),
      workspaceUsed: b.workspaceUsed,
      workspaceDailyLimit,
      minuteLimit: 5,
      globalAvailable: b.globalUsed < globalDailyLimit,
      manualFallbackAvailable: true,
      policyNotice:
        "AI requires an explicitly approved finite development work item and available shared budget. Historical unknown charges are retained separately from any approved additional allowance. Existing daily ceilings and the independent manual editor are unchanged. Provider retention and production use are not approved.",
    });
  });
}
export async function createCustomerAIDraft(
  actor: WorkspaceActor,
  raw: unknown,
  adapter = organizeCustomerDraft,
) {
  const input = customerAIInput.parse(raw);
  const { idempotencyKey, ...facts } = input,
    inputHash = hashAI(facts);
  const reserved = await workspaceTransaction(actor, async (tx) => {
    const [old] = await tx
      .select()
      .from(valoAIDrafts)
      .where(
        and(eq(valoAIDrafts.workspaceId, actor.workspaceId), eq(valoAIDrafts.idempotencyKey, idempotencyKey)),
      );
    if (old) {
      if (old.inputHash !== inputHash)
        throw new ValoProblem(
          409,
          "This request key was already used for different inputs. Start a new request.",
        );
      return { row: old, call: false };
    }
    // A single cross-workspace budget lock prevents concurrent reservations exceeding the global cost ceiling.
    await tx.execute(sql`select pg_advisory_xact_lock(760214032)`);
    const b = await budget(tx, actor.workspaceId, actor.identityId),
      isEnabled = await enabled(tx, actor.workspaceId);
    const unsupported = unsupportedCustomerInput(input),
      missing = missingCustomerFields(input);
    const canCall =
      isEnabled &&
      !unsupported &&
      !missing.length &&
      b.userMinuteUsed < 5 &&
      b.workspaceUsed < workspaceDailyLimit &&
      b.globalUsed < globalDailyLimit;
    const status: CustomerPreview["status"] = unsupported
      ? "unsupported"
      : missing.length
        ? "needs_information"
        : canCall
          ? "running"
          : "manual_fallback";
    const id = randomUUID();
    const extra = unsupported
      ? [
          "This request exceeds the four bounded business tasks. Use a scoped published resource, official authority or independent adviser; no adviser availability is implied.",
        ]
      : !isEnabled
        ? ["AI is disabled. The independent manual editor remains available."]
        : b.userMinuteUsed >= 5
          ? [
              "The existing five-requests-per-minute AI limit has been reached. Retry after a minute or continue manually.",
            ]
          : !canCall && !missing.length
            ? [
                "The development daily AI ceiling has been reached. Continue manually or retry after the UTC reset.",
              ]
            : [];
    const preview = customerPreview(id, input, status, null, inputHash, canCall ? null : 0, null, extra);
    const [row] = await tx
      .insert(valoAIDrafts)
      .values({
        id,
        workspaceId: actor.workspaceId,
        actorId: actor.identityId,
        idempotencyKey,
        inputHash,
        task: input.task,
        status,
        promptVersion: `${customerPromptVersion}/${customerNoticeVersion}`,
        budgetReserved: canCall,
        preview,
        providerRuns: [],
        failureCode: canCall
          ? null
          : status === "manual_fallback"
            ? !hasApprovedInferenceContext("customer")
              ? "AI_MANAGED_BUDGET_HELD"
              : b.userMinuteUsed >= 5
                ? "AI_MINUTE_QUOTA"
                : "AI_DISABLED_OR_DAILY_QUOTA"
            : null,
      })
      .returning();
    await workspaceEvent(tx, actor, "customer_ai.preview_created", id);
    return { row: row!, call: canCall };
  });
  if (!reserved.call) return serializeAIPreview(reserved.row);
  let result: Awaited<ReturnType<typeof organizeCustomerDraft>>;
  try {
    result = await adapter(input);
  } catch {
    result = { plan: null, runs: [], providerInputHash: "", failureCode: "AI_PROVIDER_UNAVAILABLE" };
  }
  return workspaceTransaction(actor, async (tx) => {
    const [row] = await tx
      .select()
      .from(valoAIDrafts)
      .where(and(eq(valoAIDrafts.workspaceId, actor.workspaceId), eq(valoAIDrafts.id, reserved.row.id)))
      .for("update");
    if (!row) throw new ValoProblem(404, "AI preview not found");
    if (row.status !== "running") return serializeAIPreview(row);
    const calls = result.runs.filter((r) => r.outboundAttempted).length;
    const model = [...result.runs].reverse().find((r) => r.outboundAttempted && r.model)?.model ?? null;
    const preview = customerPreview(
      row.id,
      input,
      result.plan ? "ready" : "manual_fallback",
      result.plan,
      inputHash,
      calls,
      model,
      result.failureCode
        ? [
            `${result.failureCode}: AI did not provide a usable draft. Supplied fields remain editable; no successful AI completion is claimed.`,
          ]
        : [],
    );
    const [updated] = await tx
      .update(valoAIDrafts)
      .set({
        status: preview.status,
        preview,
        plan: result.plan,
        providerRuns: result.runs,
        providerCalls: calls,
        providerInputHash: result.providerInputHash || null,
        failureCode: result.failureCode,
        updatedAt: new Date(),
      })
      .where(eq(valoAIDrafts.id, row.id))
      .returning();
    await workspaceEvent(tx, actor, "customer_ai.preview_finished", row.id);
    return serializeAIPreview(updated!);
  });
}
export async function getCustomerAIDraft(actor: WorkspaceActor, id: string) {
  return workspaceTransaction(actor, async (tx) => {
    const [row] = await tx
      .select()
      .from(valoAIDrafts)
      .where(and(eq(valoAIDrafts.workspaceId, actor.workspaceId), eq(valoAIDrafts.id, id)))
      .for("update");
    if (!row) throw new ValoProblem(404, "AI preview not found");
    if (row.status === "running" && Date.now() - row.createdAt.getTime() > 90000) {
      const p = serializeAIPreview(row);
      const preview = {
        ...p,
        status: "manual_fallback",
        providerCalls: null,
        limitations: [
          ...p.limitations,
          "AI request was interrupted. Provider completion is unknown; it was not automatically retried. Continue from supplied fields.",
        ],
      };
      const [updated] = await tx
        .update(valoAIDrafts)
        .set({
          status: "manual_fallback",
          preview,
          failureCode: "AI_INTERRUPTED_COMPLETION_UNKNOWN",
          updatedAt: new Date(),
        })
        .where(eq(valoAIDrafts.id, id))
        .returning();
      return serializeAIPreview(updated!);
    }
    return serializeAIPreview(row);
  });
}
export async function acceptCustomerAIDraft(actor: WorkspaceActor, id: string, raw: unknown) {
  const selection = AcceptCustomerAIDraftBody.strict().parse(raw);
  if (!selection.confirmBusinessDraft)
    throw new ValoProblem(
      422,
      "Confirm that this is your business draft, not verified legal or payment evidence.",
    );
  const input = documentInput.parse({ title: selection.title, content: selection.content }),
    selectionHash = hashAI(input);
  const documentId = await workspaceTransaction(actor, async (tx) => {
    const [row] = await tx
      .select()
      .from(valoAIDrafts)
      .where(and(eq(valoAIDrafts.workspaceId, actor.workspaceId), eq(valoAIDrafts.id, id)))
      .for("update");
    if (!row) throw new ValoProblem(404, "AI preview not found");
    const preview = serializeAIPreview(row);
    if (row.acceptedDocumentId) {
      if ((row.preview as Record<string, unknown>).acceptedSelectionHash !== selectionHash)
        throw new ValoProblem(
          409,
          "This preview is already saved. Open its existing document to edit, rather than silently replacing it.",
        );
      return row.acceptedDocumentId;
    }
    if (["running", "unsupported"].includes(row.status))
      throw new ValoProblem(
        422,
        "This preview cannot be saved yet. Continue in the independent manual editor.",
      );
    if (input.content.financialInput?.kind !== row.task)
      throw new ValoProblem(422, "Keep the matching structured financial model.");
    const docId = await createDocumentInTransaction(
      tx,
      actor,
      input,
      row.status === "ready" ? "customer_ai" : "manual",
    );
    await tx
      .update(valoAIDrafts)
      .set({
        acceptedDocumentId: docId,
        preview: { ...preview, acceptedSelectionHash: selectionHash, acceptedDocumentId: docId },
        updatedAt: new Date(),
      })
      .where(eq(valoAIDrafts.id, id));
    await workspaceEvent(tx, actor, "customer_ai.accepted_into_private_document", docId, 1);
    return docId;
  });
  return getDocument(actor, documentId);
}
