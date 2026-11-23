import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  valoSupportCases,
  valoSupportMessages,
  valoSupportActions,
  valoSupportEscalations,
  valoContentVersions,
  valoRuleReleases,
} from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import type { StaffActor } from "../staff";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Case = typeof valoSupportCases.$inferSelect;

const body = z.string().trim().min(8).max(4000);
const base = { idempotencyKey: z.string().uuid(), expectedVersion: z.number().int().min(1) };

export const contentTriageSchema = z
  .object({ ...base, action: z.enum(["acknowledge", "resolve", "hold_and_reassess"]), body })
  .strict();

export type ContentTriageDeps = {
  pageValue: (v: unknown) => number;
  hash: (v: unknown) => string;
  requireSupportStaff: (tx: Tx, actor: StaffActor, role?: "support" | "content") => Promise<unknown>;
  currentSupportStaff: (tx: Tx, actor: StaffActor, role: "support" | "content") => Promise<void>;
  lockedCase: (tx: Tx, id: string, workspaceId?: string) => Promise<Case>;
  replay: (
    tx: Tx,
    row: Case,
    actorId: string,
    input: { idempotencyKey: string; expectedVersion: number },
  ) => Promise<boolean>;
  change: (
    tx: Tx,
    row: Case,
    actorId: string,
    input: { idempotencyKey: string; expectedVersion: number },
    action: string,
    update: Partial<Pick<Case, "status" | "assignedTo">>,
  ) => Promise<Case>;
};

export async function listContentSupportEscalations(
  deps: Pick<ContentTriageDeps, "pageValue" | "requireSupportStaff">,
  actor: StaffActor,
  rawPage?: unknown,
) {
  const page = deps.pageValue(rawPage);
  return db.transaction(async (tx) => {
    await deps.requireSupportStaff(tx, actor, "content");
    const rows = await tx
      .select({
        escalation: valoSupportEscalations,
        caseVersion: valoSupportCases.version,
        ticketId: valoSupportCases.ticketId,
      })
      .from(valoSupportEscalations)
      .innerJoin(valoSupportCases, eq(valoSupportCases.id, valoSupportEscalations.caseId))
      .where(
        sql`NOT EXISTS (SELECT 1 FROM valo_privacy_tombstones p WHERE p.workspace_id=${valoSupportCases.workspaceId})`,
      )
      .orderBy(desc(valoSupportEscalations.createdAt), desc(valoSupportEscalations.id))
      .limit(26)
      .offset((page - 1) * 25);
    return {
      escalations: rows
        .slice(0, 25)
        .map((r) => ({ ...r.escalation, caseVersion: r.caseVersion, reference: `VALO-${r.ticketId}` })),
      page,
      pageSize: 25,
      hasMore: rows.length > 25,
      notice:
        "Content triage only. Acknowledgement or resolution does not approve publication. Hold and reassess uses the existing source authority and queues a separate review; no AI call or message is dispatched.",
    };
  });
}

export async function runContentSupportEscalation(
  deps: ContentTriageDeps,
  actor: StaffActor,
  id: string,
  raw: unknown,
) {
  const input = { ...contentTriageSchema.parse(raw), escalationId: id };
  const sourceReason = `Support content triage ${id}; request ${deps.hash(input)}. Reassess the exact referred version.`;
  const prepared = await db.transaction(async (tx) => {
    await deps.requireSupportStaff(tx, actor, "content");
    const [e] = await tx.select().from(valoSupportEscalations).where(eq(valoSupportEscalations.id, id));
    if (!e) throw new ValoProblem(404, "Content escalation not found.");
    const row = await deps.lockedCase(tx, e.caseId);
    await deps.currentSupportStaff(tx, actor, "content");
    let replayRow = row,
      recoveringHold = false;
    if (input.action === "hold_and_reassess" && row.version !== input.expectedVersion) {
      const prior = (
        await tx.execute(sql`SELECT actor_id,action,reason,current FROM valo_safety_control_audit
        WHERE request_key=${input.idempotencyKey}::uuid`)
      ).rows[0];
      const current = prior?.current as
        { kind?: unknown; id?: unknown; version?: unknown; impactId?: unknown } | undefined;
      if (
        prior?.actor_id === actor.identityId &&
        prior.action === "hold_version" &&
        prior.reason === sourceReason &&
        current?.kind === e.targetKind &&
        current.id === e.targetId &&
        current.version === e.targetVersion &&
        typeof current.impactId === "string"
      ) {
        replayRow = { ...row, version: input.expectedVersion };
        recoveringHold = true;
      }
    }
    if (await deps.replay(tx, replayRow, actor.identityId, input))
      return { replayed: true as const, escalation: e, caseVersion: row.version };
    if (e.status === "resolved" && !recoveringHold)
      throw new ValoProblem(409, "This content triage is already resolved.");
    const target =
      e.targetKind === "content"
        ? (
            await tx
              .select({ hash: valoContentVersions.candidateHash, version: valoContentVersions.version })
              .from(valoContentVersions)
              .where(eq(valoContentVersions.id, e.targetId))
          )[0]
        : (
            await tx
              .select({ hash: valoRuleReleases.manifestHash, version: valoRuleReleases.version })
              .from(valoRuleReleases)
              .where(eq(valoRuleReleases.id, e.targetId))
          )[0];
    if (!target || target.hash !== e.targetHash || target.version !== e.targetVersion)
      throw new ValoProblem(409, "The exact referred version changed. Prepare a fresh escalation.");
    return { replayed: false as const, escalation: e, caseVersion: row.version };
  });
  if (prepared.replayed)
    return { ...prepared, notice: "Previously saved content triage; no action repeated." };
  let impactId: string | null = null;
  if (input.action === "hold_and_reassess") {
    const { actOnSourceControls } = await import("../sources");
    // The source service owns its transaction, current role/MFA, exclusive
    // source lock, exact-version hold, idempotency and correction-review queue.
    // It retains a request digest, never raw customer/support text in its audit.
    const held = await actOnSourceControls(actor, {
      action: "hold_version",
      kind: prepared.escalation.targetKind,
      id: prepared.escalation.targetId,
      version: prepared.escalation.targetVersion,
      requestKey: input.idempotencyKey,
      reason: sourceReason,
    });
    const result = held.result as { impactId?: unknown };
    if (typeof result.impactId !== "string" || !z.string().uuid().safeParse(result.impactId).success)
      throw new ValoProblem(
        503,
        "Source reassessment did not return durable lineage. No triage completion is claimed.",
      );
    impactId = result.impactId;
  }
  return db.transaction(async (tx) => {
    await deps.requireSupportStaff(tx, actor, "content");
    let row = await deps.lockedCase(tx, prepared.escalation.caseId);
    await deps.currentSupportStaff(tx, actor, "content");
    const [e] = await tx
      .select()
      .from(valoSupportEscalations)
      .where(eq(valoSupportEscalations.id, id))
      .for("update");
    if (!e) throw new ValoProblem(404, "Content escalation is unavailable.");
    const [old] = await tx
      .select()
      .from(valoSupportActions)
      .where(
        and(
          eq(valoSupportActions.caseId, row.id),
          eq(valoSupportActions.actorId, actor.identityId),
          eq(valoSupportActions.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (old) {
      if (old.payloadHash !== deps.hash(input))
        throw new ValoProblem(409, "This request key belongs to another action.");
      return {
        escalation: e,
        caseVersion: row.version,
        notice: "Previously saved content triage; no action repeated.",
      };
    }
    // A completed durable hold may be recovered after an unrelated customer
    // reply incremented the case version. Never repeat it with a new key.
    if (!impactId && row.version !== input.expectedVersion)
      throw new ValoProblem(409, "Case changed during triage. Reload before trying again.", row.version);
    if (e.status === "resolved" && !impactId)
      throw new ValoProblem(409, "Triage resolved concurrently. Reload its recorded outcome.");
    // A concurrent triage closure does not undo a committed source hold. Link
    // its durable lineage while preserving the closure instead of reporting a
    // misleading rejection after effects or generating another hold key.
    const [updated] = await tx
      .update(valoSupportEscalations)
      .set({
        status: e.status === "resolved" || input.action === "resolve" ? "resolved" : "acknowledged",
        ...(impactId ? { sourceImpactId: impactId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(valoSupportEscalations.id, id))
      .returning();
    await tx.insert(valoSupportMessages).values({
      id: randomUUID(),
      caseId: row.id,
      workspaceId: row.workspaceId,
      authorId: actor.identityId,
      authorKind: "staff",
      visibility: "internal",
      body: input.body,
    });
    row = await deps.change(tx, row, actor.identityId, input, `content_triage_${input.action}`, {});
    return {
      escalation: updated!,
      caseVersion: row.version,
      notice: impactId
        ? "Exact version held and reassessment queued by the content authority. No AI review, publication or external message was performed."
        : "Content triage saved. This does not approve or publish the referred version.",
    };
  });
}
